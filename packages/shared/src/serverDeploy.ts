// Deploying to the person's own server: the Dockerfile for the repository's stack, the GitHub Actions job that builds
// the image, pushes it to GHCR and restarts the container over SSH, and the fixed script that restart runs on the
// server. Pure, so the deploy sheet, the job and the tests write the same files without a repository or a server.
import { CI_CHECK, CI_MANIFESTS } from './ciWorkflow'

/** The workflow file the job lives in; rollbacks and Deploy to production dispatch it. */
export const SERVER_WORKFLOW = 'deploy.yml'
export const SERVER_WORKFLOW_PATH = `.github/workflows/${SERVER_WORKFLOW}`

/** The repository secrets the job reads; Ramu writes them through secrets sync's GitHub Actions target. */
export const SERVER_SECRETS = {
  key: 'RAMU_SSH_KEY',
  knownHosts: 'RAMU_SSH_KNOWN_HOSTS',
  host: 'RAMU_SSH_HOST',
  user: 'RAMU_SSH_USER',
  port: 'RAMU_SSH_PORT',
} as const

/**
 * Docker's own install steps for Ubuntu and Debian, shown for the person to run on the server. Ramu never installs
 * software on the server or runs anything there as root.
 */
export const DOCKER_INSTALL_STEPS = [
  'curl -fsSL https://get.docker.com -o get-docker.sh',
  'sudo sh get-docker.sh',
  'sudo usermod -aG docker "$USER"',
] as const

/** Where Docker documents those steps. */
export const DOCKER_INSTALL_PAGE = 'https://docs.docker.com/engine/install/ubuntu/'

/** The container's name on the server for a GitHub repository: lowercase letters, digits and dashes. */
export function serverAppName(repository: string): string {
  return (
    repository
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'app'
  )
}

export interface ServerDockerfile {
  content: string
  /** The port the app listens on inside the container, which Caddy forwards to. */
  port: number
  /** What it runs, in a few words, for the pull request's description. */
  summary: string
}

/** Root files whose contents the Dockerfile depends on: CI's manifests, and manage.py for a Django project's name. */
export const DOCKER_MANIFESTS = [...CI_MANIFESTS, 'manage.py'] as const

/** What the repository's default branch holds at its root. */
export interface DockerFacts {
  files: readonly string[]
  manifests: Partial<Record<(typeof DOCKER_MANIFESTS)[number], string>>
}

/** Never baked into the image: dependencies are installed inside it, and secrets come from the server's env file. */
export const DOCKERIGNORE = ['.git', 'node_modules', '.env', '.env.*', '!.env.example', '.DS_Store', ''].join('\n')

function packageJson(text: string | undefined): {
  scripts: Record<string, string>
  deps: Set<string>
} {
  try {
    const parsed = JSON.parse(text ?? '{}') as {
      scripts?: Record<string, unknown>
      dependencies?: Record<string, unknown>
      devDependencies?: Record<string, unknown>
    }
    const scripts = Object.fromEntries(
      Object.entries(parsed.scripts ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
    return {
      scripts,
      deps: new Set([...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})]),
    }
  } catch {
    return { scripts: {}, deps: new Set() }
  }
}

const json = (argv: string[]) => JSON.stringify(argv)

/** A Caddy image serving built files on 8080, falling back to index.html for single-page apps. */
function staticStage(from: string, spa: boolean): string[] {
  const tryFiles = spa ? '{path} {path}/ /index.html' : '{path} {path}/ {path}.html'
  return [
    'FROM caddy:2-alpine',
    `COPY --from=build ${from} /srv`,
    `RUN printf ':8080 {\\n\\troot * /srv\\n\\ttry_files ${tryFiles}\\n\\tfile_server\\n\\tencode gzip\\n}\\n' > /etc/caddy/Caddyfile`,
    'EXPOSE 8080',
  ]
}

function nodeDockerfile(facts: DockerFacts, files: ReadonlySet<string>): ServerDockerfile | null {
  const pkg = packageJson(facts.manifests['package.json'])
  const bun = files.has('bun.lock') || files.has('bun.lockb')
  const pnpm = files.has('pnpm-lock.yaml')
  const yarn = files.has('yarn.lock')
  const manager = bun ? 'bun' : pnpm ? 'pnpm' : yarn ? 'yarn' : 'npm'
  const install = bun
    ? 'bun install --frozen-lockfile'
    : pnpm
      ? 'corepack enable && pnpm install --frozen-lockfile'
      : yarn
        ? `corepack enable && yarn install ${files.has('.yarnrc.yml') ? '--immutable' : '--frozen-lockfile'}`
        : files.has('package-lock.json')
          ? 'npm ci'
          : 'npm install'
  const base = bun ? 'oven/bun:1' : 'node:lts-slim'
  const build = pkg.scripts.build ? [`RUN ${manager} run build`] : []
  const prepare = [`FROM ${base} AS build`, 'WORKDIR /app', 'COPY . .', `RUN ${install}`, ...build]
  if (pkg.scripts.start) {
    // NODE_ENV is set after the install, so the build still has its development dependencies.
    return {
      content: [
        ...prepare,
        'ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0',
        'EXPOSE 3000',
        `CMD ${json([manager, 'run', 'start'])}`,
        '',
      ].join('\n'),
      port: 3000,
      summary: `installs with ${manager}${build.length ? ', builds' : ''} and runs \`${manager} run start\` on port 3000`,
    }
  }
  // A build without a start script is a static site; Vite and Astro both write it to dist.
  if (!pkg.scripts.build) return null
  return {
    content: [...prepare, '', ...staticStage('/app/dist', pkg.deps.has('vite') && !pkg.deps.has('astro')), ''].join(
      '\n',
    ),
    port: 8080,
    summary: `builds with ${manager} and serves \`dist\` with Caddy on port 8080`,
  }
}

function pythonDockerfile(facts: DockerFacts, files: ReadonlySet<string>): ServerDockerfile | null {
  const declared = `${facts.manifests['pyproject.toml'] ?? ''}\n${facts.manifests['requirements.txt'] ?? ''}`
  const uses = (name: string) => new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`, 'im').test(declared)
  const install = files.has('requirements.txt')
    ? 'pip install --no-cache-dir -r requirements.txt'
    : 'pip install --no-cache-dir .'
  let server: string[]
  let summary: string
  let extra: string
  if (files.has('manage.py')) {
    // The settings module manage.py names is the project package whose wsgi module gunicorn serves.
    const project = /DJANGO_SETTINGS_MODULE['"]\s*,\s*['"]([A-Za-z_][\w]*)\.settings/.exec(
      facts.manifests['manage.py'] ?? '',
    )?.[1]
    if (!project) return null
    server = ['gunicorn', `${project}.wsgi`, '--bind', '0.0.0.0:8000']
    summary = `serves the Django project \`${project}\` with gunicorn on port 8000`
    extra = 'gunicorn'
  } else if (uses('fastapi')) {
    const module = files.has('main.py') ? 'main:app' : files.has('app') ? 'app.main:app' : null
    if (!module) return null
    server = ['uvicorn', module, '--host', '0.0.0.0', '--port', '8000']
    summary = `serves \`${module}\` with uvicorn on port 8000`
    extra = 'uvicorn'
  } else if (uses('flask') && files.has('app.py')) {
    server = ['gunicorn', 'app:app', '--bind', '0.0.0.0:8000']
    summary = 'serves the Flask app in `app.py` with gunicorn on port 8000'
    extra = 'gunicorn'
  } else return null
  return {
    content: [
      'FROM python:3-slim',
      'WORKDIR /app',
      'ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1',
      'COPY . .',
      `RUN ${install} && pip install --no-cache-dir ${extra}`,
      'EXPOSE 8000',
      `CMD ${json(server)}`,
      '',
    ].join('\n'),
    port: 8000,
    summary,
  }
}

const GO_DOCKERFILE = [
  'FROM golang:1 AS build',
  'WORKDIR /src',
  'COPY . .',
  'RUN CGO_ENABLED=0 go build -o /out/app .',
  '',
  'FROM gcr.io/distroless/static-debian12',
  'COPY --from=build /out/app /app',
  'ENV PORT=8080',
  'EXPOSE 8080',
  'ENTRYPOINT ["/app"]',
  '',
].join('\n')

/**
 * A Dockerfile for the repository's stack, or null when Ramu cannot tell how the app starts (an agent writes one
 * then). The app listens on the returned port inside the container.
 */
export function serverDockerfile(facts: DockerFacts): ServerDockerfile | null {
  const files = new Set(facts.files)
  if (files.has('package.json')) return nodeDockerfile(facts, files)
  if (files.has('requirements.txt') || files.has('pyproject.toml') || files.has('manage.py'))
    return pythonDockerfile(facts, files)
  if (files.has('go.mod'))
    return { content: GO_DOCKERFILE, port: 8080, summary: 'builds the Go module and runs it on port 8080' }
  if (files.has('index.html'))
    return {
      content: [
        'FROM alpine AS build',
        'WORKDIR /site',
        'COPY . .',
        'RUN rm -rf .git .github Dockerfile .dockerignore',
        '',
        ...staticStage('/site', false),
        '',
      ].join('\n'),
      port: 8080,
      summary: 'serves the site’s files with Caddy on port 8080',
    }
  return null
}

/** The port an existing Dockerfile exposes, or null when it names none. */
export function exposedPort(dockerfile: string): number | null {
  const port = Number(/^\s*EXPOSE\s+(\d{1,5})/im.exec(dockerfile)?.[1])
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
}

/**
 * Runs on the server for every deploy and rollback, from the job and from Ramu alike: pulls the image (with a
 * registry token on standard input, logged out right after), replaces the app's container, and puts the previous image
 * back when the new one does not stay up. The running image and the one before it are kept; older ones are removed.
 * It is sent as one fixed `sh -c` argument with every value base64-encoded after it, so nothing a person or a
 * repository supplies is ever parsed by the server's shell. It must never contain a single quote.
 */
export const SERVER_DEPLOY_SCRIPT = [
  'set -eu',
  'd() { printf %s "${1#v}" | base64 -d; }',
  'app=$(d "$1"); image=$(d "$2"); user=$(d "${3:-v}")',
  'case "$app" in ""|*[!a-z0-9-]*) echo "Unexpected app name." >&2; exit 2;; esac',
  'case "$image" in ""|*[!a-z0-9./:_@-]*) echo "Unexpected image name." >&2; exit 2;; esac',
  'dir="$HOME/ramu/apps/$app"',
  'mkdir -p "$dir"',
  '[ -f "$dir/env" ] || { : > "$dir/env"; chmod 600 "$dir/env"; }',
  'token=$(cat)',
  'pulled=0',
  'if [ -n "$token" ]; then printf %s "$token" | docker login ghcr.io -u "$user" --password-stdin >/dev/null; fi',
  'docker pull -q "$image" >/dev/null && pulled=1 || true',
  'if [ -n "$token" ]; then docker logout ghcr.io >/dev/null 2>&1 || true; fi',
  'if [ "$pulled" = 0 ] && ! docker image inspect "$image" >/dev/null 2>&1; then echo "Could not pull $image." >&2; exit 1; fi',
  'docker network inspect ramu >/dev/null 2>&1 || docker network create ramu >/dev/null',
  'current=$(cat "$dir/image" 2>/dev/null || true)',
  'start() {',
  '  docker rm -f "ramu-$app" >/dev/null 2>&1 || true',
  '  docker run -d --name "ramu-$app" --network ramu --restart unless-stopped --env-file "$dir/env" --label "dev.ramu.app=$app" "$1" >/dev/null',
  '}',
  'start "$image"',
  'sleep 10',
  'if [ "$(docker inspect -f "{{.State.Running}} {{.RestartCount}}" "ramu-$app")" != "true 0" ]; then',
  '  echo "The new version stopped right after starting. Its log:" >&2',
  '  docker logs --tail 80 "ramu-$app" >&2 2>&1 || true',
  '  if [ -n "$current" ] && [ "$current" != "$image" ]; then start "$current"; echo "Put $current back." >&2; fi',
  '  exit 1',
  'fi',
  'if [ -n "$current" ] && [ "$current" != "$image" ]; then printf "%s\\n" "$current" > "$dir/previous"; fi',
  'printf "%s\\n" "$image" > "$dir/image"',
  'previous=$(cat "$dir/previous" 2>/dev/null || true)',
  'docker image ls --format "{{.Repository}}:{{.Tag}}" "${image%:*}" | while read -r ref; do',
  '  if [ "$ref" != "$image" ] && [ "$ref" != "$previous" ]; then docker image rm "$ref" >/dev/null 2>&1 || true; fi',
  'done',
  'echo "Running $image"',
].join('\n')

export interface ServerWorkflowFacts {
  /** The container's name on the server, from `serverAppName`. */
  app: string
  defaultBranch: string
  /** The repository has Ramu's CI workflow, so deploys wait for it to pass. */
  afterCi: boolean
}

/** A YAML scalar for a branch name: plain when that reads the same, double-quoted otherwise. */
const scalar = (value: string) => (/^[A-Za-z0-9_./-]+$/.test(value) ? value : JSON.stringify(value))

/**
 * The deploy job: after CI passes on the default branch (or on every push there without CI), build the image, push it
 * to GHCR tagged with the commit, and restart the container over SSH with the pinned host key. Dispatching it with an
 * earlier commit's `tag` deploys that image again without building, which is how Ramu rolls back.
 */
export function serverWorkflow(facts: ServerWorkflowFacts): string {
  const branch = scalar(facts.defaultBranch)
  const trigger = facts.afterCi
    ? ['  workflow_run:', `    workflows: [${CI_CHECK}]`, '    types: [completed]', `    branches: [${branch}]`]
    : ['  push:', `    branches: [${branch}]`]
  const secret = (name: string) => `\${{ secrets.${name} }}`
  return [
    '# Deploys to your own server. Generated by Ramu; see the Deploy sheet.',
    'name: Deploy',
    'run-name: Deploy ${{ inputs.tag || github.event.workflow_run.head_sha || github.sha }}',
    '',
    'on:',
    ...trigger,
    '  workflow_dispatch:',
    '    inputs:',
    '      tag:',
    '        description: The commit of an earlier deploy to put back; empty builds the branch',
    '        required: false',
    '        type: string',
    '',
    'permissions:',
    '  contents: read',
    '  packages: write',
    '',
    'concurrency:',
    '  group: deploy',
    '  cancel-in-progress: false',
    '',
    'jobs:',
    '  deploy:',
    '    name: Deploy',
    "    if: github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success'",
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Choose the image',
    '        id: image',
    '        env:',
    '          TAG: ${{ inputs.tag }}',
    '          SHA: ${{ github.event.workflow_run.head_sha || github.sha }}',
    '        run: |',
    '          if [ -n "$TAG" ] && ! printf \'%s\' "$TAG" | grep -Eq \'^[0-9a-f]{40}$\'; then echo "::error::tag must be a full commit SHA"; exit 1; fi',
    '          echo "name=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_OUTPUT"',
    '          echo "tag=${TAG:-$SHA}" >> "$GITHUB_OUTPUT"',
    '          if [ -n "$TAG" ]; then echo "build=false" >> "$GITHUB_OUTPUT"; else echo "build=true" >> "$GITHUB_OUTPUT"; fi',
    '      - uses: actions/checkout@v4',
    "        if: steps.image.outputs.build == 'true'",
    '        with:',
    '          ref: ${{ steps.image.outputs.tag }}',
    '      - uses: docker/login-action@v3',
    "        if: steps.image.outputs.build == 'true'",
    '        with:',
    '          registry: ghcr.io',
    '          username: ${{ github.actor }}',
    '          password: ${{ secrets.GITHUB_TOKEN }}',
    '      - uses: docker/build-push-action@v6',
    "        if: steps.image.outputs.build == 'true'",
    '        with:',
    '          context: .',
    '          push: true',
    '          tags: ${{ steps.image.outputs.name }}:${{ steps.image.outputs.tag }}',
    '      - name: Restart on the server',
    '        env:',
    '          IMAGE: ${{ steps.image.outputs.name }}:${{ steps.image.outputs.tag }}',
    `          APP: ${facts.app}`,
    `          SSH_KEY: ${secret(SERVER_SECRETS.key)}`,
    `          SSH_KNOWN_HOSTS: ${secret(SERVER_SECRETS.knownHosts)}`,
    `          SSH_HOST: ${secret(SERVER_SECRETS.host)}`,
    `          SSH_USER: ${secret(SERVER_SECRETS.user)}`,
    `          SSH_PORT: ${secret(SERVER_SECRETS.port)}`,
    '          REGISTRY_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
    '          DEPLOY_SCRIPT: |',
    ...SERVER_DEPLOY_SCRIPT.split('\n').map((line) => `            ${line}`),
    '        run: |',
    '          install -m 700 -d ~/.ssh',
    '          printf \'%s\\n\' "$SSH_KEY" > ~/.ssh/ramu',
    '          chmod 600 ~/.ssh/ramu',
    '          printf \'%s\\n\' "$SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts',
    '          b64() { printf \'v%s\' "$(printf \'%s\' "$1" | base64 -w0)"; }',
    '          printf \'%s\' "$REGISTRY_TOKEN" | ssh -i ~/.ssh/ramu -p "$SSH_PORT" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o BatchMode=yes -l "$SSH_USER" -- "$SSH_HOST" \\',
    '            "sh -c \'$DEPLOY_SCRIPT\' ramu $(b64 "$APP") $(b64 "$IMAGE") $(b64 "$GITHUB_ACTOR")"',
    '',
  ].join('\n')
}
