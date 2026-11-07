// The CI workflow Set up CI writes: the toolchain from the repository's lockfile, a cached install, then the lint,
// typecheck, test and build steps the project has, on pull requests and pushes to the default branch. Pure, so the
// desktop action and the agent tool write the same file and tests cover every stack without a repository.

/** The forges whose CI file Ramu writes. */
export type CiForge = 'github' | 'gitlab'

export type CiToolchain = 'pnpm' | 'yarn' | 'bun' | 'npm' | 'uv' | 'pip' | 'bundler' | 'go'

/** Root files whose contents name the steps; everything else is known by its name alone. */
export const CI_MANIFESTS = ['package.json', 'pyproject.toml', 'requirements.txt', 'Gemfile'] as const
type CiManifest = (typeof CI_MANIFESTS)[number]

/** What the repository's default branch holds at its root. */
export interface CiFacts {
  /** File and folder names at the repository root. */
  files: readonly string[]
  /** The contents of the manifests that exist. */
  manifests: Partial<Record<CiManifest, string>>
  defaultBranch: string
  /** The build and test commands the project's `ramu.json` names; they replace the detected ones. */
  stack?: { build?: string; test?: string }
}

export interface CiStep {
  name: 'Lint' | 'Typecheck' | 'Test' | 'Build'
  run: string
}

export interface CiWorkflow {
  forge: CiForge
  /** Where the file goes, relative to the repository root. */
  path: string
  content: string
  toolchain: CiToolchain
  steps: CiStep[]
}

/** What Set up CI would add to a repository, read from its default branch. */
export interface CiPreview {
  forge: CiForge
  path: string
  toolchain: CiToolchain
  steps: CiStep[]
  defaultBranch: string
  /** The default branch already has this file, so there is nothing to set up. */
  exists: boolean
  /** Requiring CI before merge is offered checked: Ramu created this repository, so no one relies on its old rules. */
  requireByDefault: boolean
}

/** What happened to branch protection after Set up CI, when the person asked for it. */
export type CiProtection =
  { state: 'required' | 'already' | 'protected' | 'unsupported' } | { state: 'failed'; message: string }

export interface CiSetupResult {
  url: string | null
  path: string
  protection: CiProtection | null
}

/** The check name the job reports, which branch protection requires. */
export const CI_CHECK = 'CI'

const NODE: readonly CiToolchain[] = ['pnpm', 'yarn', 'bun', 'npm']

/** The package manager from the lockfile; a manifest alone falls back to the ecosystem's default installer. */
function toolchainOf(files: ReadonlySet<string>): CiToolchain | null {
  if (files.has('pnpm-lock.yaml')) return 'pnpm'
  if (files.has('yarn.lock')) return 'yarn'
  if (files.has('bun.lock') || files.has('bun.lockb')) return 'bun'
  if (files.has('package-lock.json') || files.has('package.json')) return 'npm'
  if (files.has('uv.lock')) return 'uv'
  if (files.has('requirements.txt') || files.has('pyproject.toml')) return 'pip'
  if (files.has('Gemfile')) return 'bundler'
  if (files.has('go.mod')) return 'go'
  return null
}

function scriptsOf(packageJson: string | undefined): Record<string, string> {
  try {
    const parsed = JSON.parse(packageJson ?? '{}') as { scripts?: unknown }
    if (!parsed.scripts || typeof parsed.scripts !== 'object') return {}
    return Object.fromEntries(
      Object.entries(parsed.scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

function packageManagerOf(packageJson: string | undefined): string | null {
  try {
    const value = (JSON.parse(packageJson ?? '{}') as { packageManager?: unknown }).packageManager
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

function nodeSteps(toolchain: CiToolchain, scripts: Record<string, string>): CiStep[] {
  const run = (script: string) => `${toolchain} run ${script}`
  const steps: CiStep[] = []
  if (scripts.lint) steps.push({ name: 'Lint', run: run('lint') })
  const typecheck = ['typecheck', 'type-check', 'check-types'].find((name) => scripts[name])
  if (typecheck) steps.push({ name: 'Typecheck', run: run(typecheck) })
  // npm init's placeholder test script always fails, so it is not a test suite.
  if (scripts.test && !/no test specified/.test(scripts.test)) steps.push({ name: 'Test', run: run('test') })
  if (scripts.build) steps.push({ name: 'Build', run: run('build') })
  return steps
}

function pythonSteps(toolchain: 'uv' | 'pip', facts: CiFacts, files: ReadonlySet<string>): CiStep[] {
  const declared = `${facts.manifests['pyproject.toml'] ?? ''}\n${facts.manifests['requirements.txt'] ?? ''}`
  const uses = (name: string) => new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`, 'm').test(declared)
  const tool = (command: string) => (toolchain === 'uv' ? `uv run ${command}` : `python -m ${command}`)
  const steps: CiStep[] = []
  if (uses('ruff')) steps.push({ name: 'Lint', run: tool('ruff check .') })
  if (uses('mypy')) steps.push({ name: 'Typecheck', run: tool('mypy .') })
  if (uses('pytest')) steps.push({ name: 'Test', run: tool('pytest') })
  else if (files.has('manage.py'))
    steps.push({ name: 'Test', run: toolchain === 'uv' ? 'uv run manage.py test' : 'python manage.py test' })
  return steps
}

function rubySteps(gemfile: string, files: ReadonlySet<string>): CiStep[] {
  const gem = (name: string) => new RegExp(`^\\s*gem\\s+["']${name}["']`, 'm').test(gemfile)
  const steps: CiStep[] = []
  if (gem('rubocop') || gem('rubocop-rails-omakase')) steps.push({ name: 'Lint', run: 'bundle exec rubocop' })
  if (gem('rails')) steps.push({ name: 'Test', run: 'bin/rails test' })
  else if (gem('rspec') || gem('rspec-rails')) steps.push({ name: 'Test', run: 'bundle exec rspec' })
  else if (files.has('Rakefile')) steps.push({ name: 'Test', run: 'bundle exec rake' })
  return steps
}

function stepsOf(toolchain: CiToolchain, facts: CiFacts, files: ReadonlySet<string>): CiStep[] {
  let steps: CiStep[]
  if (NODE.includes(toolchain)) steps = nodeSteps(toolchain, scriptsOf(facts.manifests['package.json']))
  else if (toolchain === 'uv' || toolchain === 'pip') steps = pythonSteps(toolchain, facts, files)
  else if (toolchain === 'bundler') steps = rubySteps(facts.manifests.Gemfile ?? '', files)
  else
    steps = [
      { name: 'Lint', run: 'go vet ./...' },
      { name: 'Test', run: 'go test ./...' },
      { name: 'Build', run: 'go build ./...' },
    ]
  // The project's own commands win over a guess, and a command named twice runs once.
  const declared: CiStep[] = []
  if (facts.stack?.test) declared.push({ name: 'Test', run: facts.stack.test })
  if (facts.stack?.build) declared.push({ name: 'Build', run: facts.stack.build })
  const order: CiStep['name'][] = ['Lint', 'Typecheck', 'Test', 'Build']
  const merged = [...steps.filter((step) => !declared.some((own) => own.name === step.name)), ...declared].sort(
    (a, b) => order.indexOf(a.name) - order.indexOf(b.name),
  )
  return merged.filter((step, index) => merged.findIndex((other) => other.run === step.run) === index)
}

/** A YAML scalar: plain when that reads the same, double-quoted (JSON is valid YAML) otherwise. */
function scalar(value: string): string {
  return /^[A-Za-z0-9_./][\w ./@+=-]*$/.test(value) && !/\s$/.test(value) ? value : JSON.stringify(value)
}

interface Setup {
  /** GitHub Actions steps (already indented as list items under `steps:`), before the install. */
  actions: string[]
  install: string
  gitlab: { image: string; prepare: string[]; variables: Record<string, string>; cache: string[]; key: string }
}

function setupOf(toolchain: CiToolchain, facts: CiFacts, files: ReadonlySet<string>): Setup {
  const nodeVersion = files.has('.nvmrc')
    ? ['          node-version-file: .nvmrc']
    : files.has('.node-version')
      ? ['          node-version-file: .node-version']
      : ['          node-version: lts/*']
  const setupNode = (cache: string | null) => [
    '      - uses: actions/setup-node@v4',
    '        with:',
    ...nodeVersion,
    ...(cache ? [`          cache: ${cache}`] : []),
  ]
  const nodeImage = 'node:lts'
  switch (toolchain) {
    case 'pnpm':
      return {
        // Without a packageManager field the action needs a version; with one, naming it again is an error.
        actions: [
          '      - uses: pnpm/action-setup@v4',
          ...(packageManagerOf(facts.manifests['package.json'])?.startsWith('pnpm@')
            ? []
            : ['        with:', '          version: 10']),
          ...setupNode('pnpm'),
        ],
        install: 'pnpm install --frozen-lockfile',
        gitlab: {
          image: nodeImage,
          prepare: ['npm install --global pnpm', 'pnpm config set store-dir .pnpm-store'],
          variables: {},
          cache: ['.pnpm-store/'],
          key: 'pnpm-lock.yaml',
        },
      }
    case 'yarn': {
      const berry = files.has('.yarnrc.yml')
      return {
        actions: [...(berry ? ['      - run: corepack enable'] : []), ...setupNode('yarn')],
        install: berry ? 'yarn install --immutable' : 'yarn install --frozen-lockfile',
        gitlab: {
          image: nodeImage,
          prepare: berry ? ['corepack enable'] : [],
          variables: { YARN_CACHE_FOLDER: '$CI_PROJECT_DIR/.yarn-cache' },
          cache: ['.yarn-cache/'],
          key: 'yarn.lock',
        },
      }
    }
    case 'bun': {
      const lock = files.has('bun.lock') ? 'bun.lock' : 'bun.lockb'
      return {
        actions: [
          '      - uses: oven-sh/setup-bun@v2',
          '      - uses: actions/cache@v4',
          '        with:',
          '          path: ~/.bun/install/cache',
          `          key: bun-\${{ runner.os }}-\${{ hashFiles('${lock}') }}`,
        ],
        install: 'bun install --frozen-lockfile',
        gitlab: {
          image: 'oven/bun:1',
          prepare: [],
          variables: { BUN_INSTALL_CACHE_DIR: '$CI_PROJECT_DIR/.bun-cache' },
          cache: ['.bun-cache/'],
          key: lock,
        },
      }
    }
    case 'npm': {
      const locked = files.has('package-lock.json')
      return {
        actions: setupNode(locked ? 'npm' : null),
        install: locked ? 'npm ci' : 'npm install',
        gitlab: {
          image: nodeImage,
          prepare: [],
          variables: { npm_config_cache: '$CI_PROJECT_DIR/.npm' },
          cache: ['.npm/'],
          key: locked ? 'package-lock.json' : 'package.json',
        },
      }
    }
    case 'uv':
      return {
        actions: ['      - uses: astral-sh/setup-uv@v6', '        with:', '          enable-cache: true'],
        install: 'uv sync --locked',
        gitlab: {
          image: 'python:3',
          prepare: ['pip install uv'],
          variables: { UV_CACHE_DIR: '$CI_PROJECT_DIR/.uv-cache' },
          cache: ['.uv-cache/'],
          key: 'uv.lock',
        },
      }
    case 'pip': {
      const requirements = files.has('requirements.txt')
      return {
        actions: [
          '      - uses: actions/setup-python@v5',
          '        with:',
          files.has('.python-version')
            ? '          python-version-file: .python-version'
            : "          python-version: '3.x'",
          '          cache: pip',
        ],
        install: requirements ? 'pip install -r requirements.txt' : 'pip install -e .',
        gitlab: {
          image: 'python:3',
          prepare: [],
          variables: { PIP_CACHE_DIR: '$CI_PROJECT_DIR/.pip-cache' },
          cache: ['.pip-cache/'],
          key: requirements ? 'requirements.txt' : 'pyproject.toml',
        },
      }
    }
    case 'bundler':
      return {
        // setup-ruby reads .ruby-version itself; `ruby` is the latest stable release otherwise.
        actions: [
          '      - uses: ruby/setup-ruby@v1',
          '        with:',
          ...(files.has('.ruby-version') ? [] : ['          ruby-version: ruby']),
          '          bundler-cache: true',
        ],
        install: '',
        gitlab: {
          image: 'ruby:3',
          prepare: [],
          variables: { BUNDLE_PATH: 'vendor/bundle' },
          cache: ['vendor/bundle/'],
          key: files.has('Gemfile.lock') ? 'Gemfile.lock' : 'Gemfile',
        },
      }
    case 'go':
      return {
        actions: ['      - uses: actions/setup-go@v5', '        with:', '          go-version-file: go.mod'],
        install: 'go mod download',
        gitlab: {
          image: 'golang:1',
          prepare: [],
          variables: { GOPATH: '$CI_PROJECT_DIR/.go' },
          cache: ['.go/pkg/mod/'],
          key: 'go.sum',
        },
      }
  }
}

function githubWorkflow(facts: CiFacts, setup: Setup, steps: CiStep[]): string {
  return [
    `name: ${CI_CHECK}`,
    '',
    'on:',
    '  pull_request:',
    '  push:',
    `    branches: [${scalar(facts.defaultBranch)}]`,
    '',
    'permissions:',
    '  contents: read',
    '',
    'concurrency:',
    '  group: ci-${{ github.ref }}',
    '  cancel-in-progress: true',
    '',
    'jobs:',
    '  ci:',
    `    name: ${CI_CHECK}`,
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    ...setup.actions,
    ...(setup.install ? ['      - name: Install', `        run: ${scalar(setup.install)}`] : []),
    ...steps.flatMap((step) => [`      - name: ${step.name}`, `        run: ${scalar(step.run)}`]),
    '',
  ].join('\n')
}

function gitlabPipeline(setup: Setup, steps: CiStep[]): string {
  const { gitlab } = setup
  const variables = Object.entries(gitlab.variables)
  const before = [...gitlab.prepare, ...(setup.install ? [setup.install] : [])]
  const script = steps.length ? steps.map((step) => step.run) : ['echo "Installed"']
  return [
    'workflow:',
    '  rules:',
    '    - if: $CI_PIPELINE_SOURCE == "merge_request_event"',
    '    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH',
    '',
    'ci:',
    `  image: ${gitlab.image}`,
    ...(variables.length ? ['  variables:', ...variables.map(([name, value]) => `    ${name}: ${scalar(value)}`)] : []),
    '  cache:',
    '    key:',
    '      files:',
    `        - ${gitlab.key}`,
    '    paths:',
    ...gitlab.cache.map((path) => `      - ${path}`),
    ...(before.length ? ['  before_script:', ...before.map((line) => `    - ${scalar(line)}`)] : []),
    '  script:',
    ...script.map((line) => `    - ${scalar(line)}`),
    '',
  ].join('\n')
}

/** The CI file for a repository, or null when no lockfile or manifest names a toolchain Ramu knows. */
export function ciWorkflow(forge: CiForge, facts: CiFacts): CiWorkflow | null {
  const files = new Set(facts.files)
  const toolchain = toolchainOf(files)
  if (!toolchain) return null
  const steps = stepsOf(toolchain, facts, files)
  const setup = setupOf(toolchain, facts, files)
  return forge === 'github'
    ? {
        forge,
        path: '.github/workflows/ci.yml',
        content: githubWorkflow(facts, setup, steps),
        toolchain,
        steps,
      }
    : { forge, path: '.gitlab-ci.yml', content: gitlabPipeline(setup, steps), toolchain, steps }
}
