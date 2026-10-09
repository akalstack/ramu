// Formats and lints files with the project's own tools (Prettier, Biome, Oxc, ESLint), so the editor
// follows each repository's configuration. Nothing here writes to disk: formatters read the unsaved
// buffer from stdin and return text, and linters either read the buffer or inspect the saved file.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, extname, join, relative, sep } from 'node:path'
import type { FormatResult, LintDiagnostic, LintResult } from '../shared/types'

interface ToolSpec {
  id: string
  label: string
  pkg: string
  bin: string
  /** Config file names; a `package.json` key or a direct dependency also counts. */
  configs: string[]
  packageKey?: string
  /** Native executable (Python, Go, Rust) instead of a Node package. */
  native?: { exe: string }
  /** A `[tool.<name>]` table in pyproject.toml counts as configuration. */
  pyprojectTable?: string
  extensions: string[]
}

const SCRIPT = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts']
const configNames = (stem: string, extensions: string[]) => extensions.map((extension) => `${stem}.${extension}`)

const TOOLS: Record<string, ToolSpec> = {
  prettier: { id: 'prettier', label: 'Prettier', pkg: 'prettier', bin: 'prettier', packageKey: 'prettier', configs: ['.prettierrc', ...configNames('.prettierrc', ['json', 'json5', 'yaml', 'yml', 'toml', ...SCRIPT]), ...configNames('prettier.config', SCRIPT)], extensions: [...SCRIPT, 'json', 'jsonc', 'json5', 'css', 'scss', 'less', 'html', 'vue', 'md', 'mdx', 'yaml', 'yml', 'graphql'] },
  biome: { id: 'biome', label: 'Biome', pkg: '@biomejs/biome', bin: 'biome', configs: ['biome.json', 'biome.jsonc'], extensions: [...SCRIPT, 'json', 'jsonc', 'css'] },
  oxfmt: { id: 'oxfmt', label: 'Oxfmt', pkg: 'oxfmt', bin: 'oxfmt', configs: ['.oxfmtrc.json', '.oxfmtrc.jsonc', ...configNames('oxfmt.config', SCRIPT)], extensions: [...SCRIPT, 'json', 'jsonc', 'json5', 'css', 'scss', 'less', 'html', 'vue', 'md', 'mdx', 'yaml', 'yml', 'toml', 'graphql'] },
  eslint: { id: 'eslint', label: 'ESLint', pkg: 'eslint', bin: 'eslint', packageKey: 'eslintConfig', configs: [...configNames('eslint.config', SCRIPT), '.eslintrc', ...configNames('.eslintrc', ['js', 'cjs', 'json', 'yaml', 'yml'])], extensions: [...SCRIPT, 'vue'] },
  ruff: { id: 'ruff', label: 'Ruff', pkg: 'ruff', bin: 'ruff', native: { exe: 'ruff' }, pyprojectTable: 'tool.ruff', configs: ['ruff.toml', '.ruff.toml'], extensions: ['py', 'pyi'] },
  gofmt: { id: 'gofmt', label: 'gofmt', pkg: 'gofmt', bin: 'gofmt', native: { exe: 'gofmt' }, configs: ['go.mod'], extensions: ['go'] },
  rustfmt: { id: 'rustfmt', label: 'rustfmt', pkg: 'rustfmt', bin: 'rustfmt', native: { exe: 'rustfmt' }, configs: ['Cargo.toml'], extensions: ['rs'] },
  oxlint: { id: 'oxlint', label: 'Oxlint', pkg: 'oxlint', bin: 'oxlint', configs: ['.oxlintrc.json', ...configNames('oxlint.config', SCRIPT)], extensions: [...SCRIPT, 'vue'] },
}

// When a project has several, the first match formats; every detected linter runs and the results merge.
const FORMATTERS = ['oxfmt', 'biome', 'prettier', 'ruff', 'gofmt', 'rustfmt']
const LINTERS = ['eslint', 'ruff', 'biome', 'oxlint']
/** Linters that can read the unsaved buffer from stdin. The others only inspect the saved file. */
const LIVE_LINTERS = new Set(['eslint', 'ruff'])

export interface ToolingOptions { timeoutMs?: number }

/** `script` is a Node script for Node tools and the executable itself for native ones. */
interface Detected { spec: ToolSpec; script: string; cwd: string; env?: Record<string, string> }

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel))
}

function readText(path: string): string | null {
  try { return readFileSync(path, 'utf8') } catch { return null }
}

function readJson(path: string): Record<string, unknown> | null {
  try { return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> } catch { return null }
}

/** Directories from the file's folder up to the repository root, nearest first. */
function ancestors(root: string, file: string): string[] {
  const dirs: string[] = []
  for (let dir = dirname(file); isInside(root, dir); dir = dirname(dir)) { dirs.push(dir); if (dir === root || dirname(dir) === dir) break }
  return dirs
}

function declares(manifest: Record<string, unknown> | null, pkg: string): boolean {
  return !!manifest && ['dependencies', 'devDependencies', 'optionalDependencies'].some((field) => !!(manifest[field] as Record<string, unknown> | undefined)?.[pkg])
}

function detect(spec: ToolSpec, root: string, file: string): Detected | null {
  const dirs = ancestors(root, file)
  let cwd: string | null = null
  for (const dir of dirs) {
    if (spec.configs.some((name) => existsSync(join(dir, name)))) { cwd = dir; break }
    const manifest = readJson(join(dir, 'package.json'))
    if (manifest && (spec.packageKey && manifest[spec.packageKey] !== undefined)) { cwd = dir; break }
    if (spec.pyprojectTable && readText(join(dir, 'pyproject.toml'))?.includes(`[${spec.pyprojectTable}`)) { cwd = dir; break }
  }
  if (!cwd && !spec.native) for (const dir of dirs) if (declares(readJson(join(dir, 'package.json')), spec.pkg)) { cwd = dir; break }
  if (!cwd) return null
  if (spec.native) {
    // A project's own virtualenv comes first, then the usual install locations the app may not have on PATH.
    const search = [...dirs.flatMap((dir) => [join(dir, '.venv', 'bin'), join(dir, 'venv', 'bin'), join(dir, '.venv', 'Scripts')]), ...(process.env.PATH ?? '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/local/go/bin', join(homedir(), '.cargo', 'bin'), join(homedir(), 'go', 'bin'), join(homedir(), '.local', 'bin')]
    const exe = process.platform === 'win32' ? `${spec.native.exe}.exe` : spec.native.exe
    const found = search.filter(Boolean).map((dir) => join(dir, exe)).find((path) => existsSync(path))
    return found ? { spec, script: found, cwd, env: { PATH: [...new Set(search.filter(Boolean))].join(delimiter) } } : null
  }
  for (const dir of dirs) {
    const manifestPath = join(dir, 'node_modules', spec.pkg, 'package.json')
    const manifest = readJson(manifestPath)
    if (!manifest) continue
    const bin = typeof manifest.bin === 'string' ? manifest.bin : (manifest.bin as Record<string, string> | undefined)?.[spec.bin]
    if (!bin) continue
    const script = join(dirname(manifestPath), bin)
    if (existsSync(script)) return { spec, script, cwd }
  }
  return null
}

function supports(spec: ToolSpec, file: string): boolean {
  return spec.extensions.includes(extname(file).slice(1).toLowerCase())
}

interface RunResult { code: number | null; stdout: string; stderr: string; timedOut: boolean; overflow: boolean }

/** Tools are Node scripts, so they run on the daemon's own runtime instead of depending on `node` being on PATH. */
function run(tool: Detected, args: string[], input: string | null, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = tool.spec.native ? spawn(tool.script, args, { cwd: tool.cwd, env: { ...process.env, ...tool.env, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] }) : spawn(process.execPath, [tool.script, ...args], {
      cwd: tool.cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = '', timedOut = false, overflow = false
    const limit = 8_000_000
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk; if (stdout.length > limit) { overflow = true; child.kill('SIGKILL') } })
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(0, 20_000) })
    child.stdin.on('error', () => {})
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: stderr || error.message, timedOut, overflow }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut, overflow }) })
    child.stdin.end(input ?? undefined)
  })
}

const firstLines = (text: string, count = 6) => text.replace(/\u001b\[[0-9;]*m/g, '').trim().split('\n').slice(0, count).join('\n')

function failure(label: string, result: RunResult, timeoutMs: number): string {
  if (result.timedOut) return `${label} took longer than ${Math.round(timeoutMs / 1000)} seconds.`
  if (result.overflow) return `${label} produced too much output.`
  return firstLines(result.stderr || result.stdout) || `${label} failed.`
}

export async function formatBuffer(root: string, file: string, content: string, options: ToolingOptions = {}): Promise<FormatResult> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const tool = FORMATTERS.map((id) => TOOLS[id]!).filter((spec) => supports(spec, file)).map((spec) => detect(spec, root, file)).find((found) => found)
  if (!tool) return { tool: null, label: null, content: null, error: null }
  const id0 = tool.spec.id
  // rustfmt reads stdin as edition 2015 unless told otherwise, so the crate's own edition is passed.
  const edition = id0 === 'rustfmt' ? /^\s*edition\s*=\s*"(\d{4})"/m.exec(readText(join(tool.cwd, 'Cargo.toml')) ?? '')?.[1] ?? '2021' : ''
  const args = id0 === 'biome' ? ['format', `--stdin-file-path=${file}`] : id0 === 'ruff' ? ['format', '--stdin-filename', file, '-'] : id0 === 'gofmt' ? [] : id0 === 'rustfmt' ? ['--emit', 'stdout', '--edition', edition] : ['--stdin-filepath', file]
  const result = await run(tool, args, content, timeoutMs)
  const { id, label } = tool.spec
  if (result.code !== 0 || result.timedOut || result.overflow) return { tool: id, label, content: null, error: failure(label, result, timeoutMs) }
  // A formatter that prints nothing for a non-empty file has not understood the request; never blank the buffer.
  if (result.stdout === '' && content !== '') return { tool: id, label, content: null, error: `${label} returned no output.` }
  return { tool: id, label, content: result.stdout, error: null }
}

type Severity = LintDiagnostic['severity']

/** Lines and columns (1-based, UTF-16) for a UTF-8 byte offset into `text`. */
function positionAt(bytes: Buffer, offset: number): { line: number; column: number } {
  const before = bytes.subarray(0, Math.min(offset, bytes.length)).toString('utf8')
  const newline = before.lastIndexOf('\n')
  return { line: before.split('\n').length, column: before.length - newline }
}

function diagnostic(tool: ToolSpec, severity: Severity, message: string, code: string | null, url: string | null, line: number, column: number, endLine: number, endColumn: number): LintDiagnostic {
  const startLine = Math.max(1, line), startColumn = Math.max(1, column)
  let finishLine = Math.max(startLine, endLine || startLine), finishColumn = Math.max(1, endColumn || startColumn + 1)
  if (finishLine === startLine && finishColumn <= startColumn) finishColumn = startColumn + 1
  return { tool: tool.id, severity, message, code, url, line: startLine, column: startColumn, endLine: finishLine, endColumn: finishColumn }
}

function parseEslint(tool: ToolSpec, stdout: string): LintDiagnostic[] {
  const report = JSON.parse(stdout) as { messages?: { ruleId: string | null; severity: number; message: string; line?: number; column?: number; endLine?: number; endColumn?: number; fatal?: boolean }[] }[]
  const found: LintDiagnostic[] = []
  for (const message of report[0]?.messages ?? []) {
    // Files outside the project's config are reported as an "ignored" warning, which is noise in an editor.
    if (!message.ruleId && !message.fatal && /^File ignored/i.test(message.message)) continue
    found.push(diagnostic(tool, message.severity === 2 ? 'error' : 'warning', message.message, message.ruleId, null, message.line ?? 1, message.column ?? 1, message.endLine ?? 0, message.endColumn ?? 0))
  }
  return found
}

function parseRuff(tool: ToolSpec, stdout: string): LintDiagnostic[] {
  const found = JSON.parse(stdout || '[]') as { code: string | null; message: string; url?: string; location: { row: number; column: number }; end_location: { row: number; column: number } }[]
  // Ruff reports syntax errors with no rule code; those are errors, rule violations are warnings.
  return found.map((entry) => diagnostic(tool, entry.code ? 'warning' : 'error', entry.message, entry.code, entry.url ?? null, entry.location.row, entry.location.column, entry.end_location.row, entry.end_location.column))
}

function parseBiome(tool: ToolSpec, stdout: string): LintDiagnostic[] {
  const start = stdout.indexOf('{')
  if (start < 0) return []
  const report = JSON.parse(stdout.slice(start)) as { diagnostics?: { severity?: string; message: string; code?: { value?: string; url?: string }; location?: { range?: { start: { line: number; column: number }; end: { line: number; column: number } } } }[] }
  return (report.diagnostics ?? []).filter((entry) => entry.location?.range).map((entry) => {
    const range = entry.location!.range!, level = (entry.severity ?? '').toLowerCase()
    return diagnostic(tool, level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info', entry.message, entry.code?.value ?? null, entry.code?.url ?? null, range.start.line, range.start.column, range.end.line, range.end.column)
  })
}

function parseOxlint(tool: ToolSpec, stdout: string, content: string): LintDiagnostic[] {
  const start = stdout.indexOf('{')
  if (start < 0) return []
  const report = JSON.parse(stdout.slice(start)) as { diagnostics?: { severity?: string; message: string; code?: string; url?: string; labels?: { span: { offset: number; length: number } }[] }[] }
  const bytes = Buffer.from(content)
  return (report.diagnostics ?? []).filter((entry) => entry.labels?.[0]).map((entry) => {
    const span = entry.labels![0]!.span, from = positionAt(bytes, span.offset), to = positionAt(bytes, span.offset + span.length)
    return diagnostic(tool, entry.severity === 'error' ? 'error' : entry.severity === 'warning' ? 'warning' : 'info', entry.message, entry.code ?? null, entry.url ?? null, from.line, from.column, to.line, to.column)
  })
}

/**
 * `buffer` lints only what can read unsaved text. `saved` also runs the linters that inspect the file on disk,
 * so the caller must only use it when the buffer matches the saved file.
 */
export async function lintBuffer(root: string, file: string, content: string, scope: 'buffer' | 'saved', options: ToolingOptions = {}): Promise<LintResult> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const tools = LINTERS.map((id) => TOOLS[id]!).filter((spec) => supports(spec, file) && (scope === 'saved' || LIVE_LINTERS.has(spec.id))).map((spec) => detect(spec, root, file)).filter((found): found is Detected => !!found)
  const settled = await Promise.all(tools.map(async (tool): Promise<{ id: string; label: string; live: boolean; diagnostics: LintDiagnostic[]; error: string | null }> => {
    const { id, label } = tool.spec, live = LIVE_LINTERS.has(id)
    const args = id === 'eslint' ? ['--stdin', '--stdin-filename', file, '-f', 'json'] : id === 'ruff' ? ['check', '--stdin-filename', file, '--output-format', 'json', '--no-cache', '-'] : id === 'biome' ? ['lint', file, '--reporter=rdjson', '--colors=off'] : ['--format', 'json', file]
    const result = await run(tool, args, live ? content : null, timeoutMs)
    // Linters exit 1 when they find problems; anything else means the tool itself failed.
    if (result.timedOut || result.overflow || (result.code !== 0 && result.code !== 1)) return { id, label, live, diagnostics: [], error: failure(label, result, timeoutMs) }
    try {
      const diagnostics = id === 'eslint' ? parseEslint(tool.spec, result.stdout) : id === 'ruff' ? parseRuff(tool.spec, result.stdout) : id === 'biome' ? parseBiome(tool.spec, result.stdout) : parseOxlint(tool.spec, result.stdout, content)
      return { id, label, live, diagnostics, error: null }
    } catch { return { id, label, live, diagnostics: [], error: `${label} returned output Ramu could not read.` } }
  }))
  return {
    tools: settled.filter((entry) => !entry.error).map(({ id, label, live }) => ({ id, label, live })),
    diagnostics: settled.flatMap((entry) => entry.diagnostics),
    errors: settled.filter((entry) => entry.error).map((entry) => `${entry.label}: ${entry.error}`),
  }
}
