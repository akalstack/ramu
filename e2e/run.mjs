// Runs e2e specs with node:test, one file at a time (each file launches its own app).
//   node e2e/run.mjs                 every gating spec in e2e/specs
//   node e2e/run.mjs settings goals  only specs whose file name contains one of the words
//   node e2e/run.mjs --perf [fps]    on-demand performance and chaos checks in e2e/perf
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const perf = args.includes('--perf')
const filters = args.filter((arg) => arg !== '--perf')
const directory = join(import.meta.dirname, perf ? 'perf' : 'specs')
const files = readdirSync(directory)
  .filter((file) => file.endsWith('.spec.mjs'))
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
