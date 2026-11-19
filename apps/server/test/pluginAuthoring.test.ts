import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkPlugin, newPlugin } from '../src/plugins/authoring'

const temp = () => mkdtempSync(join(tmpdir(), 'ramu-plugin-new-'))
const fixture = join(import.meta.dirname, 'fixtures', 'plugin-mcp-server.mjs')

describe('ramu plugin new and check', () => {
  it('writes a plugin that passes its own check', async () => {
    for (const options of [
      { mcp: false, cli: false },
      { mcp: false, cli: true },
      { mcp: true, cli: false },
    ]) {
      const root = newPlugin(temp(), 'render-deploy', options)
      const report = await checkPlugin(root, { startServers: false })
      expect(report).toMatchObject({ name: 'render-deploy', problems: [] })
    }
  })

  it('refuses a bad name and a folder that is not empty', () => {
    expect(() => newPlugin(temp(), 'Render Deploy', { mcp: false, cli: false })).toThrow(/lowercase/)
    const parent = temp()
    newPlugin(parent, 'one', { mcp: false, cli: false })
    expect(() => newPlugin(parent, 'one', { mcp: false, cli: false })).toThrow(/not empty/)
  })

  it('starts each server, lists its tools and names an ability mapped to a missing tool', async () => {
    const root = temp()
    writeFileSync(
      join(root, 'plugin.json'),
      JSON.stringify({
        name: 'finder',
        mcpServers: {
          finder: { command: process.execPath, args: [fixture], env: { API: '${FINDER_KEY}', OTHER: '${NOPE}' } },
        },
        extensions: {
          'dev.getramu': {
            credentials: [{ id: 'key', label: 'Key', env: 'FINDER_KEY', kind: 'token' }],
            abilities: { web_search: { server: 'finder', tool: 'lookup' } },
          },
        },
      }),
    )
    const report = await checkPlugin(root)
    expect(report.servers).toEqual([{ name: 'finder', tools: ['search'] }])
    const messages = report.problems.map((problem) => problem.message).join('\n')
    expect(messages).toContain('no tool named lookup')
    expect(messages).toContain('${NOPE}')
    expect(messages).not.toContain('${FINDER_KEY}')
  }, 30_000)
})
