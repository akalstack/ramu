// Runs e2e specs with node:test, one file at a time (each file launches its own app).
//   node e2e/run.mjs                 every gating spec in e2e/specs
//   node e2e/run.mjs settings goals  only specs whose file name contains one of the words
//   node e2e/run.mjs --changed [ref] only specs affected by changes since `ref` (default origin/main), plus
//                                    uncommitted and untracked files; see e2e/impact.mjs. Add --list to only print them.
//   node e2e/run.mjs --perf [fps]    on-demand performance and chaos checks in e2e/perf
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { impactedSpecs } from './impact.mjs'

const args = process.argv.slice(2)
const perf = args.includes('--perf')
const changed = args.includes('--changed')
const list = args.includes('--list')
const words = args.filter((arg) => !arg.startsWith('--'))
const directory = join(import.meta.dirname, perf ? 'perf' : 'specs')
const all = readdirSync(directory).filter((file) => file.endsWith('.spec.mjs'))

let filters = words
if (changed) {
  const root = join(import.meta.dirname, '..')
  const git = (...rest) => execFileSync('git', rest, { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  const base = words[0] ?? 'origin/main'
  const files = [
    ...new Set([
      ...git('diff', '--name-only', `${git('merge-base', base, 'HEAD')[0]}`),
      ...git('ls-files', '--others', '--exclude-standard'),
    ]),
  ]
  const impact = impactedSpecs(
    files,
    all.map((file) => file.replace(/\.spec\.mjs$/, '')),
  )
  if (impact.all) {
    console.log(`e2e harness changed (${impact.why}): running every spec.`)
    filters = []
  } else if (!impact.specs.length) {
    console.log(`No desktop-facing changes since ${base}: nothing to run.`)
    process.exit(0)
  } else {
    for (const spec of impact.specs)
      console.log(`${spec.name.padEnd(20)} ${spec.why.slice(0, 3).join(', ')}${spec.why.length > 3 ? ', …' : ''}`)
    filters = impact.specs.map((spec) => `${spec.name}.spec.mjs`)
  }
  if (list) process.exit(0)
}
const files = all
  .filter((file) => !filters.length || filters.some((filter) => file.includes(filter)))
  .map((file) => join(directory, file))
if (!files.length) {
  console.error(`No ${perf ? 'perf checks' : 'specs'} match: ${filters.join(', ')}`)
  process.exit(1)
}
const result = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', `--test-timeout=${perf ? 900_000 : 300_000}`, ...files],
  { stdio: 'inherit' },
)
process.exit(result.status ?? 1)
