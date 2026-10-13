// Opt-in benchmark against a live Ollama instruct model: RAMU_LIVE_OLLAMA=1 RAMU_LIVE_EDIT_MODEL=qwen2.5-coder:7b-instruct pnpm test
import { expect, it } from 'vitest'
import { predictNextEdit, buildPrompt, NEXT_EDIT_SCHEMA, type EditRecord } from '../src/nextEdit'

interface Scenario { name: string; file: string; cursor: number; edits: EditRecord[]; /** The file after a right follow-up edit (any of these), or null when nothing more should change. */ expected: string | string[] | null }
const e = (line: number, before: string[], after: string[]): EditRecord => ({ line, before, after })
const scenarios: Scenario[] = [
  { name: 'rename parameters, update the body', cursor: 1, edits: [e(1, ['function area(w, h) {'], ['function area(width, height) {'])], file: 'function area(width, height) {\n  const result = w * h\n  return result\n}\n', expected: 'function area(width, height) {\n  const result = width * height\n  return result\n}\n' },
  { name: 'rename a function, update its caller', cursor: 1, edits: [e(1, ['export function getUser(id) {'], ['export function fetchUser(id) {'])], file: 'export function fetchUser(id) {\n  return db.find(id)\n}\n\nconst current = getUser(session.userId)\n', expected: 'export function fetchUser(id) {\n  return db.find(id)\n}\n\nconst current = fetchUser(session.userId)\n' },
  { name: 'var to const, third line left', cursor: 2, edits: [e(1, ['var host = "localhost"'], ['const host = "localhost"']), e(2, ['var port = 8080'], ['const port = 8080'])], file: 'const host = "localhost"\nconst port = 8080\nvar timeout = 30\n', expected: 'const host = "localhost"\nconst port = 8080\nconst timeout = 30\n' },
  { name: 'double to single quotes, next line', cursor: 2, edits: [e(1, ['import a from "./a"'], ["import a from './a'"]), e(2, ['import b from "./b"'], ["import b from './b'"])], file: "import a from './a'\nimport b from './b'\nimport c from \"./c\"\n", expected: "import a from './a'\nimport b from './b'\nimport c from './c'\n" },
  { name: 'console.log to logger.info, third call', cursor: 5, edits: [e(2, ['  console.log("start")'], ['  logger.info("start")']), e(5, ['  console.log("done")'], ['  logger.info("done")'])], file: 'function run() {\n  logger.info("start")\n  work()\n  more()\n  logger.info("done")\n  console.log("cleanup")\n}\n', expected: 'function run() {\n  logger.info("start")\n  work()\n  more()\n  logger.info("done")\n  logger.info("cleanup")\n}\n' },
  { name: 'rename a variable, update its use', cursor: 1, edits: [e(1, ['let cnt = 0'], ['let count = 0'])], file: 'let count = 0\nfor (const item of items) {\n  cnt++\n}\nconsole.log(cnt)\n', expected: ['let count = 0\nfor (const item of items) {\n  count++\n}\nconsole.log(cnt)\n', 'let count = 0\nfor (const item of items) {\n  cnt++\n}\nconsole.log(count)\n'] },
  { name: 'make a function async, await its call', cursor: 1, edits: [e(1, ['function load() {'], ['async function load() {'])], file: 'async function load() {\n  return fetch(url)\n}\n\nfunction main() {\n  const data = load()\n}\n', expected: 'async function load() {\n  return fetch(url)\n}\n\nfunction main() {\n  const data = await load()\n}\n' },
  { name: 'python: rename a def, update the call', cursor: 1, edits: [e(1, ['def calc_total(items):'], ['def calculate_total(items):'])], file: 'def calculate_total(items):\n    return sum(items)\n\nprint(calc_total([1, 2]))\n', expected: 'def calculate_total(items):\n    return sum(items)\n\nprint(calculate_total([1, 2]))\n' },
  { name: 'add a field, update the matching case', cursor: 3, edits: [e(3, ['  name: string'], ['  name: string', '  email: string'])], file: "interface User {\n  id: number\n  name: string\n  email: string\n}\n\nfunction describe(u: User) {\n  return `${u.id} ${u.name}`\n}\n", expected: null },
  { name: 'rename a CSS class in markup', cursor: 1, edits: [e(1, ['<div class="card-title">'], ['<div class="card-heading">'])], file: '<div class="card-heading">\n  Hello\n</div>\n<style>\n.card-title { font-weight: bold }\n</style>\n', expected: '<div class="card-heading">\n  Hello\n</div>\n<style>\n.card-heading { font-weight: bold }\n</style>\n' },
  { name: 'repeat a pattern: add a trailing comma', cursor: 2, edits: [e(1, ['  alpha: 1'], ['  alpha: 1,']), e(2, ['  beta: 2'], ['  beta: 2,'])], file: 'const config = {\n  alpha: 1,\n  beta: 2,\n  gamma: 3\n}\n', expected: 'const config = {\n  alpha: 1,\n  beta: 2,\n  gamma: 3,\n}\n' },
  { name: 'change a constant, update its use', cursor: 1, edits: [e(1, ['const MAX_RETRIES = 3'], ['const MAX_ATTEMPTS = 3'])], file: 'const MAX_ATTEMPTS = 3\n\nfor (let i = 0; i < MAX_RETRIES; i++) {\n  try_once()\n}\n', expected: 'const MAX_ATTEMPTS = 3\n\nfor (let i = 0; i < MAX_ATTEMPTS; i++) {\n  try_once()\n}\n' },
  { name: 'nothing more: finished rename', cursor: 1, edits: [e(1, ['const a = 1'], ['const total = 1'])], file: 'const total = 1\nconsole.log(total)\n', expected: null },
  { name: 'nothing more: a fix with no echo', cursor: 2, edits: [e(2, ['  return a - b'], ['  return a + b'])], file: 'function add(a, b) {\n  return a + b\n}\n', expected: null },
  { name: 'nothing more: unrelated code below', cursor: 1, edits: [e(1, ['// TODO: fix'], ['// TODO: fix later'])], file: '// TODO: fix later\nexport const x = 1\nexport const y = 2\n', expected: null },
]

const model = process.env.RAMU_LIVE_EDIT_MODEL ?? 'qwen2.5-coder:7b-instruct'
const chat = (system: string, user: string, signal: AbortSignal) => fetch('http://127.0.0.1:11434/api/chat', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: false, format: NEXT_EDIT_SCHEMA, keep_alive: '30m', options: { temperature: 0, num_predict: 400 }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) }).then(async (r) => ((await r.json()) as { message: { content: string } }).message.content)

it.skipIf(!process.env.RAMU_LIVE_OLLAMA)('live: predicts the next edit', async () => {
  let correct = 0, falseEdits = 0, missed = 0, total = 0, shouldEdit = 0
  const times: number[] = []
  for (const s of scenarios) {
    const lines = s.file.replace(/\n$/, '').split('\n')
    const started = Date.now(), result = await predictNextEdit({ chat }, { path: 'src/app.ts', lines, cursorLine: s.cursor, edits: s.edits }, new AbortController().signal); times.push(Date.now() - started)
    let outcome: string
    if (s.expected === null) { outcome = result ? 'FALSE-EDIT' : 'ok'; if (result) falseEdits++; else correct++ }
    else {
      shouldEdit++
      const applied = result ? [...lines.slice(0, result.startLine - 1), ...result.text.split('\n'), ...lines.slice(result.endLine)].join('\n') : null
      if (applied !== null && [s.expected].flat().some((want) => applied === want.replace(/\n$/, ''))) { outcome = 'ok'; correct++ } else { outcome = result ? 'WRONG' : 'MISSED'; if (!result) missed++ }
    }
    total++
    console.log(outcome.padEnd(10), s.name.padEnd(42), `${times.at(-1)}ms`, result ? JSON.stringify(result.text).slice(0, 70) : '-')
  }
  const sorted = [...times].sort((a, b) => a - b)
  console.log(`RESULT ${model}: ${correct}/${total} correct; false edits ${falseEdits}; missed ${missed}/${shouldEdit}; median ${sorted[Math.floor(sorted.length / 2)]}ms`)
  expect(buildPrompt({ path: 'a', lines: ['x'], cursorLine: 1, edits: [e(1, [], ['x'])] }).user.length).toBeGreaterThan(0)
}, 600_000)
