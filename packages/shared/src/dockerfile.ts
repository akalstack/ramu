// A Dockerfile for a repository's stack, used when an app runs in a container on this computer. Pure, so the
// server and the tests write the same file without a repository.
import { CI_MANIFESTS } from './ciWorkflow'

export interface AppDockerfile {
  content: string
  /** The port the app listens on inside the container. */
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

/** Never baked into the image: dependencies are installed inside it, and secrets come from the environment it runs with. */
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

function nodeDockerfile(facts: DockerFacts, files: ReadonlySet<string>): AppDockerfile | null {
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

function pythonDockerfile(facts: DockerFacts, files: ReadonlySet<string>): AppDockerfile | null {
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
export function appDockerfile(facts: DockerFacts): AppDockerfile | null {
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
