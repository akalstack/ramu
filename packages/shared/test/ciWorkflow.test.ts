import { describe, expect, it } from 'vitest'
import { ciWorkflow, type CiFacts } from '../src/ciWorkflow'

const facts = (files: string[], manifests: CiFacts['manifests'] = {}, extra: Partial<CiFacts> = {}): CiFacts => ({
  files,
  manifests,
  defaultBranch: 'main',
  ...extra,
})

const scripts = (entries: Record<string, string>) => JSON.stringify({ name: 'app', scripts: entries })

describe('ciWorkflow', () => {
  it('writes a GitHub workflow for pnpm with a cached, frozen install and the scripts that exist', () => {
    const workflow = ciWorkflow(
      'github',
      facts(['package.json', 'pnpm-lock.yaml', '.nvmrc'], {
        'package.json': scripts({ lint: 'eslint .', typecheck: 'tsc', test: 'vitest', build: 'vite build', dev: 'x' }),
      }),
    )!
    expect(workflow.path).toBe('.github/workflows/ci.yml')
    expect(workflow.toolchain).toBe('pnpm')
    expect(workflow.steps.map((step) => step.run)).toEqual([
      'pnpm run lint',
      'pnpm run typecheck',
      'pnpm run test',
      'pnpm run build',
    ])
    const { content } = workflow
    expect(content).toContain('  pull_request:\n  push:\n    branches: [main]')
    expect(content).toContain('permissions:\n  contents: read')
    expect(content).toContain('uses: actions/checkout@v4')
    // pnpm must be on the path before setup-node can cache its store.
    expect(content.indexOf('pnpm/action-setup@v4')).toBeLessThan(content.indexOf('actions/setup-node@v4'))
    expect(content).toContain('version: 10')
    expect(content).toContain('node-version-file: .nvmrc')
    expect(content).toContain('cache: pnpm')
    expect(content).toContain('run: pnpm install --frozen-lockfile')
    expect(content).not.toContain('dev')
    // Every action is pinned to a major version.
    for (const [, ref] of content.matchAll(/uses: [\w./-]+@(\S+)/g)) expect(ref).toMatch(/^v\d+$/)
  })

  it('lets a packageManager field name the pnpm version', () => {
    const { content } = ciWorkflow(
      'github',
      facts(['package.json', 'pnpm-lock.yaml'], { 'package.json': JSON.stringify({ packageManager: 'pnpm@9.1.0' }) }),
    )!
    expect(content).not.toContain('version: 10')
  })

  it('uses npm ci with a lockfile, npm install without one, and skips the placeholder test script', () => {
    const placeholder = scripts({ test: 'echo "Error: no test specified" && exit 1', build: 'next build' })
    const locked = ciWorkflow('github', facts(['package.json', 'package-lock.json'], { 'package.json': placeholder }))!
    expect(locked.toolchain).toBe('npm')
    expect(locked.content).toContain('run: npm ci')
    expect(locked.content).toContain('cache: npm')
    expect(locked.content).toContain('node-version: lts/*')
    expect(locked.steps).toEqual([{ name: 'Build', run: 'npm run build' }])
    const loose = ciWorkflow('github', facts(['package.json'], { 'package.json': placeholder }))!
    expect(loose.content).toContain('run: npm install')
    expect(loose.content).not.toContain('cache:')
  })

  it('tells Yarn classic from Yarn Berry', () => {
    const lint = { 'package.json': scripts({ lint: 'eslint .' }) }
    const classic = ciWorkflow('github', facts(['package.json', 'yarn.lock'], lint))!
    expect(classic.content).toContain('yarn install --frozen-lockfile')
    expect(classic.content).not.toContain('corepack')
    const berry = ciWorkflow('github', facts(['package.json', 'yarn.lock', '.yarnrc.yml'], lint))!
    expect(berry.content).toContain('yarn install --immutable')
    expect(berry.content.indexOf('corepack enable')).toBeLessThan(berry.content.indexOf('setup-node'))
    expect(berry.steps).toEqual([{ name: 'Lint', run: 'yarn run lint' }])
  })

  it('caches Bun installs keyed on its lockfile', () => {
    const { content, steps } = ciWorkflow(
      'github',
      facts(['package.json', 'bun.lock'], { 'package.json': scripts({ test: 'bun test' }) }),
    )!
    expect(content).toContain('oven-sh/setup-bun@v2')
    expect(content).toContain("hashFiles('bun.lock')")
    expect(content).toContain('bun install --frozen-lockfile')
    expect(steps).toEqual([{ name: 'Test', run: 'bun run test' }])
  })

  it('runs uv projects through uv with the tools they declare', () => {
    const pyproject = '[dependency-groups]\ndev = ["pytest>=8", "ruff", "mypy"]\n'
    const workflow = ciWorkflow('github', facts(['pyproject.toml', 'uv.lock'], { 'pyproject.toml': pyproject }))!
    expect(workflow.toolchain).toBe('uv')
    expect(workflow.content).toContain('astral-sh/setup-uv@v6')
    expect(workflow.content).toContain('enable-cache: true')
    expect(workflow.content).toContain('uv sync --locked')
    expect(workflow.steps.map((step) => step.run)).toEqual(['uv run ruff check .', 'uv run mypy .', 'uv run pytest'])
  })

  it('installs pip requirements and runs Django tests when nothing else is declared', () => {
    const workflow = ciWorkflow(
      'github',
      facts(['requirements.txt', 'manage.py'], { 'requirements.txt': 'Django==5.1\npytest-django-helpers\n' }),
    )!
    expect(workflow.toolchain).toBe('pip')
    expect(workflow.content).toContain('actions/setup-python@v5')
    expect(workflow.content).toContain("python-version: '3.x'")
    expect(workflow.content).toContain('cache: pip')
    expect(workflow.content).toContain('pip install -r requirements.txt')
    // A package whose name only contains "pytest" does not make pytest the runner.
    expect(workflow.steps).toEqual([{ name: 'Test', run: 'python manage.py test' }])
  })

  it('caches Bundler through setup-ruby and runs Rails tests', () => {
    const gemfile =
      'source "https://rubygems.org"\ngem "rails", "~> 8.0"\ngem "rubocop-rails-omakase", require: false\n'
    const workflow = ciWorkflow('github', facts(['Gemfile', 'Gemfile.lock', 'Rakefile'], { Gemfile: gemfile }))!
    expect(workflow.toolchain).toBe('bundler')
    expect(workflow.content).toContain('ruby/setup-ruby@v1')
    expect(workflow.content).toContain('bundler-cache: true')
    expect(workflow.content).toContain('ruby-version: ruby')
    expect(workflow.content).not.toContain('Install')
    expect(workflow.steps.map((step) => step.run)).toEqual(['bundle exec rubocop', 'bin/rails test'])
  })

  it('vets, tests and builds Go modules with the go.mod version', () => {
    const workflow = ciWorkflow('github', facts(['go.mod', 'go.sum', 'main.go']))!
    expect(workflow.content).toContain('go-version-file: go.mod')
    expect(workflow.steps.map((step) => step.run)).toEqual(['go vet ./...', 'go test ./...', 'go build ./...'])
  })

  it('prefers the build and test commands ramu.json names, once each', () => {
    const workflow = ciWorkflow(
      'github',
      facts(
        ['package.json', 'package-lock.json'],
        { 'package.json': scripts({ lint: 'next lint', build: 'next build', test: 'jest' }) },
        { stack: { test: 'npm run lint', build: 'npm run build -- --profile' } },
      ),
    )!
    expect(workflow.steps).toEqual([
      { name: 'Lint', run: 'npm run lint' },
      { name: 'Build', run: 'npm run build -- --profile' },
    ])
  })

  it('quotes commands YAML would read differently and follows the default branch', () => {
    const { content } = ciWorkflow(
      'github',
      facts(['go.mod'], {}, { defaultBranch: 'trunk', stack: { test: 'go test ./... && echo "ok: done"' } }),
    )!
    expect(content).toContain('branches: [trunk]')
    expect(content).toContain('run: "go test ./... && echo \\"ok: done\\""')
  })

  it('writes a GitLab pipeline for merge requests and the default branch with a lockfile-keyed cache', () => {
    const workflow = ciWorkflow(
      'gitlab',
      facts(['package.json', 'pnpm-lock.yaml'], { 'package.json': scripts({ lint: 'eslint .', build: 'vite build' }) }),
    )!
    expect(workflow.path).toBe('.gitlab-ci.yml')
    expect(workflow.content).toContain('if: $CI_PIPELINE_SOURCE == "merge_request_event"')
    expect(workflow.content).toContain('if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH')
    expect(workflow.content).toContain('image: node:lts')
    expect(workflow.content).toContain('        - pnpm-lock.yaml')
    expect(workflow.content).toContain('      - .pnpm-store/')
    expect(workflow.content).toContain('    - pnpm install --frozen-lockfile')
    expect(workflow.content).toContain('  script:\n    - pnpm run lint\n    - pnpm run build')
  })

  it('has nothing to write without a lockfile or manifest it knows', () => {
    expect(ciWorkflow('github', facts(['README.md', 'index.html']))).toBeNull()
  })
})
