import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { formatBuffer, lintBuffer } from '../src/main/tooling'

let root: string
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-tooling-'))) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

const write = (path: string, content: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content) }
/** A stand-in for a project's installed tool: a package whose `bin` is a small Node script. */
function install(pkg: string, bin: string, script: string, at = '') {
  write(join(at, 'node_modules', pkg, 'package.json'), JSON.stringify({ name: pkg, bin: { [bin]: 'cli.js' } }))
  write(join(at, 'node_modules', pkg, 'cli.js'), `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const args=process.argv.slice(2);${script}})`)
}
const upper = `process.stdout.write(input.toUpperCase())`

it('reports no tool when the project has no formatter configuration', async () => {
  write('a.ts', 'x')
  expect(await formatBuffer(root, join(root, 'a.ts'), 'x')).toEqual({ tool: null, label: null, content: null, error: null })
})

it('ignores a configuration whose tool is not installed', async () => {
  write('.prettierrc', '{}')
  expect((await formatBuffer(root, join(root, 'a.ts'), 'x')).tool).toBeNull()
})

it('formats the unsaved buffer with the project formatter and leaves the file untouched', async () => {
  write('.prettierrc', '{}'); write('a.ts', 'on disk'); install('prettier', 'prettier', upper)
  const result = await formatBuffer(root, join(root, 'a.ts'), 'unsaved buffer')
  expect(result).toMatchObject({ tool: 'prettier', label: 'Prettier', content: 'UNSAVED BUFFER', error: null })
  expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('on disk')
})

it('treats a direct dependency as enough to select a tool, and passes the file path', async () => {
  write('package.json', JSON.stringify({ devDependencies: { prettier: '3' } }))
  install('prettier', 'prettier', `process.stdout.write(args.join(' '))`)
  const file = join(root, 'src', 'a.ts')
  expect((await formatBuffer(root, file, 'x')).content).toBe(`--stdin-filepath ${file}`)
})

it('prefers Oxfmt, then Biome, then Prettier when several are configured', async () => {
  write('.prettierrc', '{}'); write('biome.json', '{}'); install('prettier', 'prettier', `process.stdout.write('p')`); install('@biomejs/biome', 'biome', `process.stdout.write('b')`)
  expect((await formatBuffer(root, join(root, 'a.ts'), 'x')).tool).toBe('biome')
  write('.oxfmtrc.json', '{}'); install('oxfmt', 'oxfmt', `process.stdout.write('o')`)
  expect((await formatBuffer(root, join(root, 'a.ts'), 'x')).tool).toBe('oxfmt')
})

it('uses the nearest configuration and runs from its folder in a monorepo', async () => {
  write('package.json', '{}'); write('packages/web/.prettierrc', '{}'); install('prettier', 'prettier', `process.stdout.write(process.cwd())`, 'packages/web')
  expect((await formatBuffer(root, join(root, 'packages/web/src/a.ts'), 'x')).content).toBe(join(root, 'packages/web'))
})

it('skips file types the tool does not handle', async () => {
  write('biome.json', '{}'); install('@biomejs/biome', 'biome', upper)
  expect((await formatBuffer(root, join(root, 'notes.md'), 'x')).tool).toBeNull()
})

it('returns the formatter error without content and never blanks the buffer', async () => {
  write('.prettierrc', '{}'); install('prettier', 'prettier', `process.stderr.write('SyntaxError: Unexpected token (1:3)\\nmore');process.exit(2)`)
  expect(await formatBuffer(root, join(root, 'a.ts'), 'x')).toMatchObject({ tool: 'prettier', content: null, error: expect.stringContaining('SyntaxError') })
  install('prettier', 'prettier', ``)
  expect((await formatBuffer(root, join(root, 'a.ts'), 'x')).error).toContain('no output')
})

it('stops a tool that runs too long', async () => {
  write('.prettierrc', '{}'); install('prettier', 'prettier', `setTimeout(()=>{}, 60000)`)
  const started = Date.now()
  const result = await formatBuffer(root, join(root, 'a.ts'), 'x', { timeoutMs: 300 })
  expect(result.error).toContain('longer than'); expect(Date.now() - started).toBeLessThan(5000)
})

it('lints the buffer with ESLint and drops the "file ignored" notice', async () => {
  write('eslint.config.js', ''); install('eslint', 'eslint', `process.stdout.write(JSON.stringify([{messages: input.includes('ignored') ? [{ruleId:null,severity:1,message:'File ignored because no matching configuration was supplied.'}] : [{ruleId:'eqeqeq',severity:2,message:'Expected ===',line:3,column:7,endLine:3,endColumn:9},{ruleId:'no-unused-vars',severity:1,message:'unused',line:1,column:1}]}]));process.exit(1)`)
  const result = await lintBuffer(root, join(root, 'a.ts'), 'a == b', 'buffer')
  expect(result.tools).toEqual([{ id: 'eslint', label: 'ESLint', live: true }])
  expect(result.diagnostics).toEqual([
    { tool: 'eslint', severity: 'error', message: 'Expected ===', code: 'eqeqeq', url: null, line: 3, column: 7, endLine: 3, endColumn: 9 },
    { tool: 'eslint', severity: 'warning', message: 'unused', code: 'no-unused-vars', url: null, line: 1, column: 1, endLine: 1, endColumn: 2 },
  ])
  expect((await lintBuffer(root, join(root, 'a.ts'), 'ignored', 'buffer')).diagnostics).toEqual([])
})

it('runs file-based linters only when the buffer matches the saved file', async () => {
  write('.oxlintrc.json', '{}'); write('biome.json', '{}')
  install('oxlint', 'oxlint', `process.stdout.write(JSON.stringify({diagnostics:[{severity:'error',message:'debugger',code:'eslint(no-debugger)',url:'https://oxc.rs/x',labels:[{span:{offset:${Buffer.byteLength('é = 1\n')},length:8}}]}]}));process.exit(1)`)
  install('@biomejs/biome', 'biome', `process.stdout.write('Checked.\\n'+JSON.stringify({diagnostics:[{severity:'WARNING',message:'noisy',code:{value:'lint/x',url:'https://biomejs.dev/x'},location:{range:{start:{line:2,column:5},end:{line:2,column:11}}}}]}));process.exit(1)`)
  const content = 'é = 1\ndebugger;\n'
  expect(await lintBuffer(root, join(root, 'a.ts'), content, 'buffer')).toEqual({ tools: [], diagnostics: [], errors: [] })
  const saved = await lintBuffer(root, join(root, 'a.ts'), content, 'saved')
  expect(saved.tools.map((tool) => [tool.id, tool.live])).toEqual([['biome', false], ['oxlint', false]])
  // Oxlint reports UTF-8 byte offsets; the editor needs UTF-16 columns (é is two bytes, one character).
  expect(saved.diagnostics.find((entry) => entry.tool === 'oxlint')).toMatchObject({ severity: 'error', line: 2, column: 1, endLine: 2, endColumn: 9, url: 'https://oxc.rs/x' })
  expect(saved.diagnostics.find((entry) => entry.tool === 'biome')).toMatchObject({ severity: 'warning', code: 'lint/x', line: 2, column: 5, endColumn: 11 })
})

it('reports a broken linter without hiding the others', async () => {
  write('eslint.config.js', ''); write('.oxlintrc.json', '{}')
  install('eslint', 'eslint', `process.stderr.write('Failed to load config');process.exit(2)`)
  install('oxlint', 'oxlint', `process.stdout.write(JSON.stringify({diagnostics:[]}))`)
  const result = await lintBuffer(root, join(root, 'a.ts'), 'x', 'saved')
  expect(result.errors).toEqual(['ESLint: Failed to load config']); expect(result.tools.map((tool) => tool.id)).toEqual(['oxlint'])
})

// Opt-in: RAMU_TOOLING_LAB=/path to a folder where prettier, eslint, @biomejs/biome, oxlint and oxfmt are installed.
it.skipIf(!process.env.RAMU_TOOLING_LAB)('works with the real tools', async () => {
  const lab = realpathSync(process.env.RAMU_TOOLING_LAB!), file = join(lab, 'bad.js'), content = 'const   x   =   1\nvar unused = 2;\nif (x == 1) { debugger }\n'
  expect((await formatBuffer(lab, file, content)).content).toContain('const x = 1')
  const result = await lintBuffer(lab, file, content, 'saved')
  expect(result.errors).toEqual([]); expect(new Set(result.diagnostics.map((entry) => entry.tool))).toEqual(new Set(['eslint', 'biome', 'oxlint']))
})

/** A stand-in for a native executable (ruff, gofmt, rustfmt): a shell script that records its arguments. */
function installNative(dir: string, name: string, script: string) { mkdirSync(dir, { recursive: true }); const path = join(dir, name); writeFileSync(path, `#!/bin/sh\n${script}\n`); chmodSync(path, 0o755) }

it.skipIf(process.platform === 'win32')('formats Python with the ruff from the project\'s virtualenv when pyproject.toml configures it', async () => {
  write('pyproject.toml', '[project]\nname = "x"\n[tool.ruff]\nline-length = 100\n'); installNative(join(root, '.venv', 'bin'), 'ruff', 'cat >/dev/null; echo "$@"')
  const file = join(root, 'pkg', 'a.py')
  expect(await formatBuffer(root, file, 'x = 1')).toMatchObject({ tool: 'ruff', label: 'Ruff', content: `format --stdin-filename ${file} -\n` })
  rmSync(join(root, 'pyproject.toml')); expect((await formatBuffer(root, file, 'x')).tool).toBeNull()
})

it.skipIf(process.platform === 'win32')('passes the crate\'s edition to rustfmt and formats Go with gofmt only inside a Go module', async () => {
  const bin = join(root, 'fakebin'); installNative(bin, 'rustfmt', 'cat >/dev/null; echo "$@"'); installNative(bin, 'gofmt', 'cat; echo formatted')
  const saved = process.env.PATH; process.env.PATH = `${bin}${delimiter}${saved}`
  try {
    write('Cargo.toml', '[package]\nname = "x"\nedition = "2024"\n')
    expect((await formatBuffer(root, join(root, 'src/main.rs'), 'fn main(){}')).content).toBe('--emit stdout --edition 2024\n')
    expect((await formatBuffer(root, join(root, 'main.go'), 'package main')).tool).toBeNull()
    write('go.mod', 'module x\n'); expect(await formatBuffer(root, join(root, 'main.go'), 'package main')).toMatchObject({ tool: 'gofmt', content: 'package mainformatted\n' })
  } finally { process.env.PATH = saved }
})

it.skipIf(process.platform === 'win32')('lints Python buffers with ruff, treating syntax errors as errors and rule violations as warnings', async () => {
  write('ruff.toml', ''); installNative(join(root, '.venv', 'bin'), 'ruff', `cat >/dev/null; echo '[{"code":"F401","message":"os imported but unused","url":"https://docs.astral.sh/ruff/rules/unused-import","location":{"row":1,"column":8},"end_location":{"row":1,"column":10}},{"code":null,"message":"SyntaxError: bad","location":{"row":3,"column":1},"end_location":{"row":3,"column":2}}]'; exit 1`)
  const result = await lintBuffer(root, join(root, 'a.py'), 'import os', 'buffer')
  expect(result.tools).toEqual([{ id: 'ruff', label: 'Ruff', live: true }])
  expect(result.diagnostics.map((d) => [d.severity, d.code, d.line, d.column, d.endColumn])).toEqual([['warning', 'F401', 1, 8, 10], ['error', null, 3, 1, 2]])
})

it.skipIf(!process.env.RAMU_NATIVE_LAB)('works with the real ruff and gofmt', async () => {
  const lab = realpathSync(process.env.RAMU_NATIVE_LAB!)
  expect((await formatBuffer(join(lab, 'pylab'), join(lab, 'pylab', 'bad.py'), 'import os\ndef f( a,b ):\n  return a+b\n')).content).toBe('import os\n\n\ndef f(a, b):\n    return a + b\n')
  const lint = await lintBuffer(join(lab, 'pylab'), join(lab, 'pylab', 'bad.py'), 'import os\ndef f( a,b ):\n  return a+b\n', 'buffer')
  expect(lint.errors).toEqual([]); expect(lint.diagnostics.map((d) => d.code)).toContain('F401')
  expect((await formatBuffer(join(lab, 'golab'), join(lab, 'golab', 'main.go'), 'package main\nfunc  main( ){\nx:=1\n_ = x}\n')).content).toBe('package main\n\nfunc main() {\n\tx := 1\n\t_ = x\n}\n')
})
