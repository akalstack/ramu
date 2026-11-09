// Copies the plugin index into src/data/plugins.json, which getramu.dev/plugins is built from. RAMU_PLUGINS_INDEX may
// name a local checkout of akalstack/ramu-plugins or a marketplace.json URL; by default it reads the published index.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT = 'https://raw.githubusercontent.com/akalstack/ramu-plugins/main/.claude-plugin/marketplace.json'
const from = process.env.RAMU_PLUGINS_INDEX ?? DEFAULT
const text = /^https:\/\//.test(from)
  ? await fetch(from).then((response) => {
      if (!response.ok) throw new Error(`${from} answered ${response.status}`)
      return response.text()
    })
  : readFileSync(join(from, '.claude-plugin', 'marketplace.json'), 'utf8')
const index = JSON.parse(text)
const plugins = index.plugins.map((entry) => {
  const ramu = entry.extensions?.['dev.getramu'] ?? {}
  return {
    name: entry.name,
    description: entry.description ?? '',
    homepage: entry.homepage ?? null,
    author: typeof entry.author === 'string' ? entry.author : (entry.author?.name ?? null),
    keywords: entry.keywords ?? entry.tags ?? [],
    category: entry.category ?? null,
    byRamu: ramu.byRamu === true,
    signed: ramu.byRamu === true || typeof ramu.signingKey === 'string',
    stacks: ramu.stacks ?? [],
    adds: ramu.adds ?? {},
  }
})
writeFileSync(
  new URL('../src/data/plugins.json', import.meta.url),
  `${JSON.stringify({ index: 'https://github.com/akalstack/ramu-plugins', plugins }, null, 2)}\n`,
)
console.log(`Wrote ${plugins.length} plugins.`)
