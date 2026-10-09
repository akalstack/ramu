import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, existsSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Connection, MessageReader, RpcError } from '../src/main/jsonrpc'
import { LspService, typescriptAdapter, type LspAdapter } from '../src/main/lsp'

const frame = (message: unknown) => { const body = JSON.stringify(message); return Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`) }

it('reads messages split across chunks, merged into one chunk, and with multi-byte text', () => {
  const seen: unknown[] = [], reader = new MessageReader((message) => seen.push(message))
  const a = frame({ jsonrpc: '2.0', id: 1, result: 'é→' }), b = frame({ jsonrpc: '2.0', method: 'x' })
  reader.push(a.subarray(0, 7)); reader.push(a.subarray(7, a.length - 3)); expect(seen).toEqual([])
  reader.push(Buffer.concat([a.subarray(a.length - 3), b]))
  expect(seen).toEqual([{ jsonrpc: '2.0', id: 1, result: 'é→' }, { jsonrpc: '2.0', method: 'x' }])
})

// A tiny language server. It logs what it receives so tests can assert on the protocol traffic.
const SERVER = `
const fs=require('fs');const log=process.env.LSP_LOG;const note=(m)=>log&&fs.appendFileSync(log,m+'\\n');
let buf=Buffer.alloc(0);const send=(m)=>{const b=JSON.stringify(m);process.stdout.write('Content-Length: '+Buffer.byteLength(b)+'\\r\\n\\r\\n'+b)};
const texts={};
function handle(m){
  note(m.method||('response '+m.id));
  if(m.method==='initialize')return send({jsonrpc:'2.0',id:m.id,result:{capabilities:{}}});
  if(m.method==='shutdown')return send({jsonrpc:'2.0',id:m.id,result:null});
  if(m.method==='exit')process.exit(0);
  if(m.method==='textDocument/didOpen'||m.method==='textDocument/didChange'){
    const uri=m.params.textDocument.uri;const text=m.params.textDocument.text??m.params.contentChanges[0].text;texts[uri]=text;
    if(text.includes('CRASH'))process.exit(1);
    send({jsonrpc:'2.0',method:'textDocument/publishDiagnostics',params:{uri,diagnostics:text.includes('BAD')?[{severity:1,message:'Bad thing',code:2322,range:{start:{line:1,character:2},end:{line:1,character:5}}}]:[]}});
  }
  if(m.method==='textDocument/completion'){
    if((texts[m.params.textDocument.uri]||'').includes('SLOW'))return;
    return send({jsonrpc:'2.0',id:m.id,result:{isIncomplete:false,items:[{label:'example',kind:6,detail:'const example: 1',sortText:'11',textEdit:{newText:'example',range:{start:{line:0,character:0},end:{line:0,character:2}}}},{label:'log',kind:2,insertText:'log(\${1:x})',insertTextFormat:2}]}});
  }
  if(m.method==='textDocument/hover')return send({jsonrpc:'2.0',id:m.id,result:{contents:[{language:'ts',value:'const x: 1'},'docs'],range:{start:{line:0,character:6},end:{line:0,character:7}}}});
  if(m.method==='textDocument/definition')return send({jsonrpc:'2.0',id:m.id,result:[{targetUri:process.env.LSP_TARGET,targetRange:{start:{line:2,character:0},end:{line:2,character:9}},targetSelectionRange:{start:{line:2,character:4},end:{line:2,character:9}}}]});
}
process.stdin.on('data',(d)=>{buf=Buffer.concat([buf,d]);for(;;){const i=buf.indexOf('\\r\\n\\r\\n');if(i<0)return;const len=+/Content-Length: (\\d+)/i.exec(buf.subarray(0,i).toString())[1];if(buf.length<i+4+len)return;const m=JSON.parse(buf.subarray(i+4,i+4+len).toString());buf=buf.subarray(i+4+len);handle(m)}});
`
let root: string, serverFile: string, logFile: string
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-lsp-'))); serverFile = join(root, 'server.cjs'); logFile = join(root, 'log.txt'); writeFileSync(serverFile, SERVER); writeFileSync(logFile, ''); mkdirSync(join(root, 'proj')); writeFileSync(join(root, 'proj', 'a.ts'), 'ex'); writeFileSync(join(root, 'proj', 'b.ts'), 'x') })
afterEach(() => rmSync(root, { recursive: true, force: true }))
const lines = () => readFileSync(logFile, 'utf8').split('\n').filter(Boolean)
const wait = async (predicate: () => boolean, message = 'condition') => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise((r) => setTimeout(r, 30)) } throw new Error(`Timed out waiting for ${message}`) }

const fakeAdapter = (): LspAdapter => ({ id: 'fake', label: 'Fake', matches: (f) => f.endsWith('.ts'), languageId: () => 'typescript', resolve: (cwd) => ({ command: process.execPath, args: [serverFile], cwd, env: { LSP_LOG: logFile, LSP_TARGET: pathToFileURL(join(cwd, 'b.ts')).href, ELECTRON_RUN_AS_NODE: '1' } }) })
const events: { channel: string; payload: any }[] = []
const make = (options = {}) => { events.length = 0; return new LspService((channel, payload) => events.push({ channel, payload }), { adapters: [fakeAdapter()], idleMs: 80, restartDelayMs: 20, ...options }) }
const cwd = () => join(root, 'proj'), file = (name = 'a.ts') => join(cwd(), name)

it('matches responses to requests, surfaces errors, and rejects when the server stops', async () => {
  const child = spawn(process.execPath, ['-e', `process.stdin.on('data',()=>{});setTimeout(()=>process.exit(0),300)`], { stdio: ['pipe', 'pipe', 'pipe'] })
  const conn = new Connection(child, 5000)
  const pending = conn.request('never')
  await expect(pending).rejects.toBeInstanceOf(RpcError)
})

it('cancels a request and tells the server to stop working on it', async () => {
  const service = make(); await service.open('o1', cwd(), file(), 'SLOW')
  const pending = service.completion(file(), 'q1', 1, 1, null)
  await wait(() => lines().includes('textDocument/completion')); service.cancel('q1')
  expect((await pending).items).toEqual([])
  await wait(() => lines().includes('$/cancelRequest'), 'cancelRequest'); await service.stop()
})

it('publishes diagnostics with 1-based positions and clears them when the file closes', async () => {
  const service = make(); await service.open('o1', cwd(), file(), 'BAD')
  await wait(() => events.some((e) => e.channel === 'lsp:diagnostics' && e.payload.diagnostics.length))
  expect(events.find((e) => e.payload.diagnostics?.length)!.payload).toEqual({ cwd: cwd(), path: 'a.ts', diagnostics: [{ severity: 'error', message: 'Bad thing', code: '2322', source: 'Fake', range: { startLine: 2, startColumn: 3, endLine: 2, endColumn: 6 } }] })
  service.close('o1', file()); expect(events.at(-1)!.payload).toEqual({ cwd: cwd(), path: 'a.ts', diagnostics: [] }); await service.stop()
})

it('maps completion, hover and definition results into editor positions', async () => {
  const service = make(); await service.open('o1', cwd(), file(), 'ex')
  const list = await service.completion(file(), 'q', 1, 3, null)
  expect(list.items[0]).toMatchObject({ label: 'example', kind: 4 /* Variable */, detail: 'const example: 1', insertText: 'example', snippet: false, range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 3 } })
  expect(list.items[1]).toMatchObject({ label: 'log', kind: 0 /* Method */, snippet: true, insertText: 'log(${1:x})', range: null })
  expect(await service.hover(file(), 'h', 1, 7)).toEqual({ contents: ['```ts\nconst x: 1\n```', 'docs'], range: { startLine: 1, startColumn: 7, endLine: 1, endColumn: 8 } })
  expect(await service.definition(file(), 'd', 1, 1)).toEqual([{ file: file('b.ts'), range: { startLine: 3, startColumn: 5, endLine: 3, endColumn: 10 } }])
  await service.stop()
})

it('opens a shared file once, sends edits, and closes it when the last window releases it', async () => {
  const service = make()
  await service.open('task1/a', cwd(), file(), 'one'); await service.open('task2/a', cwd(), file(), 'one')
  service.change(file(), 'two')
  await wait(() => lines().includes('textDocument/didChange'), 'didChange'); expect(lines().filter((l) => l === 'textDocument/didOpen')).toHaveLength(1)
  service.close('task1/a', file()); await new Promise((r) => setTimeout(r, 150)); expect(lines()).not.toContain('textDocument/didClose')
  service.close('task2/a', file()); await wait(() => lines().includes('textDocument/didClose'), 'didClose')
  await service.stop()
})

it('releases every document when the last window disconnects, then shuts an idle server down', async () => {
  const service = make(); await service.open('o1', cwd(), file(), 'x'); await service.open('o2', cwd(), file('b.ts'), 'x')
  service.releaseAll()
  await wait(() => lines().filter((l) => l === 'textDocument/didClose').length === 2, 'both didClose')
  await wait(() => lines().includes('exit'), 'idle shutdown'); expect(lines()).toContain('shutdown')
})

it('restarts a crashed server, replays open documents, and gives up after repeated crashes', async () => {
  const service = make(); await service.open('o1', cwd(), file(), 'fine')
  service.change(file(), 'CRASH now')
  await wait(() => lines().filter((l) => l === 'initialize').length === 2, 'restart')
  await wait(() => lines().filter((l) => l === 'textDocument/didOpen').length === 2, 'replayed didOpen')
  // The replayed text contains CRASH too, so the server keeps dying until Ramu stops trying.
  await wait(() => events.some((e) => e.channel === 'lsp:status' && e.payload.state === 'failed'), 'failure status')
  expect((await service.open('o2', cwd(), file('b.ts'), 'x')).server).toBeNull()
  await service.stop()
})

it('reports no server for files the project has no language server for', async () => {
  expect((await make().open('o1', cwd(), join(cwd(), 'notes.md'), 'x')).server).toBeNull()
})

it('uses the project\'s own TypeScript: native TS 7 server, or typescript-language-server on the project\'s tsserver', () => {
  const project = join(root, 'ts7'); mkdirSync(project)
  const write = (path: string, content: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content) }
  const exe = process.platform === 'win32' ? 'tsc.exe' : 'tsc'
  write(join(project, 'node_modules/typescript/package.json'), '{"version":"7.0.2"}'); write(join(project, 'node_modules/@typescript', `typescript-${process.platform}-${process.arch}`, 'lib', exe), '')
  expect(typescriptAdapter.resolve(project, join(project, 'src/a.ts'))).toMatchObject({ command: join(project, 'node_modules/@typescript', `typescript-${process.platform}-${process.arch}`, 'lib', exe), args: ['--lsp', '--stdio'] })
  const old = join(root, 'ts5'); write(join(old, 'node_modules/typescript/package.json'), '{"version":"5.4.0"}'); write(join(old, 'node_modules/typescript/lib/tsserver.js'), '')
  const resolved = typescriptAdapter.resolve(old, join(old, 'a.ts'))!
  expect(resolved.command).toBe(process.execPath); expect(resolved.args.at(-1)).toBe('--stdio'); expect((resolved.initializationOptions as any).tsserver.path).toBe(join(old, 'node_modules/typescript/lib/tsserver.js'))
  // With no project TypeScript, Ramu's own copy is used rather than leaving the file without a server.
  const bare = join(root, 'bare'); mkdirSync(bare)
  expect(((typescriptAdapter.resolve(bare, join(bare, 'a.ts')) as any).initializationOptions.tsserver.path as string).endsWith('tsserver.js')).toBe(true)
  expect(typescriptAdapter.matches('x.tsx')).toBe(true); expect(typescriptAdapter.matches('x.py')).toBe(false); expect(typescriptAdapter.languageId('x.tsx')).toBe('typescriptreact')
})

// Opt-in: LSP_LAB_5 / LSP_LAB_7 are folders containing typescript (5.x or 7.x), other.ts exporting `example`, and probe.ts.
for (const [name, env] of [['TypeScript 5 via typescript-language-server', 'LSP_LAB_5'], ['TypeScript 7 native server', 'LSP_LAB_7']] as const) {
  it.skipIf(!process.env[env])(`${name} completes across files and reports type errors`, async () => {
    const lab = realpathSync(process.env[env]!), events2: any[] = []
    const service = new LspService((c, p) => events2.push({ c, p }), { idleMs: 100 })
    const probe = join(lab, 'probe.ts')
    expect((await service.open('lab', lab, probe, "import { example } from './other'\nconst n: number = 'x'\nexam\n")).server).toBe('TypeScript')
    const list = await service.completion(probe, 'q', 3, 5, null)
    expect(list.items.some((item) => item.label === 'example')).toBe(true)
    await wait(() => events2.some((e) => e.c === 'lsp:diagnostics' && e.p.diagnostics.some((d: any) => /not assignable to type 'number'/.test(d.message))), 'type error')
    expect(await service.hover(probe, 'h', 2, 7)).toMatchObject({ contents: [expect.stringContaining('number')] })
    expect((await service.definition(probe, 'd', 1, 10))[0]!.file).toBe(join(lab, 'other.ts'))
    await service.stop(); expect(existsSync(probe)).toBe(false)
  }, 60_000)
}
