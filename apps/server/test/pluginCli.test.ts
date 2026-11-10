import { describe, expect, it, vi } from 'vitest'
import type { PluginCli, PluginCredential } from '@ramu/shared/plugins'
import {
  cliCommand,
  cliCommandReads,
  cliOutput,
  credentialEnvironment,
  registerPluginCliTools,
  type PluginCliTarget,
} from '../src/plugins/cli'
import type { PluginSecret } from '../src/plugins/service'

type Handler = (args: Record<string, unknown>, extra: { signal?: AbortSignal }) => Promise<{ isError?: boolean }>

const slot: PluginCredential = {
  id: 'token',
  label: 'API token',
  env: 'CLOUDFLARE_API_TOKEN',
  kind: 'token',
  fields: [{ id: 'account', label: 'Account ID', env: 'CLOUDFLARE_ACCOUNT_ID', kind: 'text' }],
}
const cli: PluginCli = { binaries: ['wrangler'], npx: 'wrangler@4', reads: [['whoami'], ['d1', 'list']] }
const target: PluginCliTarget = { plugin: 'cloudflare', pluginId: 'p1', cli, slot }
const secret: PluginSecret = { token: 'tok_secret', fields: { account: 'acc_1' }, account: 'Ana' }

function setup(approve: boolean, saved: PluginSecret | null = secret, entry: PluginCliTarget = target) {
  const tools = new Map<string, Handler>()
  const server = { registerTool: (name: string, _def: unknown, handler: Handler) => void tools.set(name, handler) }
  const asked: string[] = []
  const source = { id: 's1', parentId: null, cwd: '/tmp/shop', settings: { access: 'full' } }
  const run = vi.fn(async () => ({ exitCode: 0, output: 'ok', timedOut: false }))
  const secretOf = vi.fn(async () => saved)
  registerPluginCliTools(
    server as never,
    { clis: () => [entry], secret: secretOf },
    source as never,
    () => source as never,
    async (detail) => {
      asked.push(detail)
      return approve
    },
    run,
  )
  return { tool: tools.get('platform_cli')!, run, asked, secretOf }
}

describe('platform_cli', () => {
  it('is not offered when no installed plugin has a CLI', () => {
    const tools = new Map<string, Handler>()
    const server = { registerTool: (name: string, _def: unknown, handler: Handler) => void tools.set(name, handler) }
    registerPluginCliTools(
      server as never,
      { clis: () => [], secret: async () => null },
      {} as never,
      () => ({}) as never,
      async () => true,
    )
    expect(tools.size).toBe(0)
  })

  it('runs a command that only reads without asking, in the thread’s checkout with the saved credential', async () => {
    const { tool, run, asked, secretOf } = setup(false)
    await tool({ platform: 'cloudflare', args: ['d1', 'list', '--json'] }, {})
    expect(asked).toEqual([])
    expect(secretOf).toHaveBeenCalledWith('p1', 'token')
    expect(run).toHaveBeenCalledWith(target, ['d1', 'list', '--json'], '/tmp/shop', secret, undefined)
  })

  it('asks with a card naming any other command, and runs nothing when refused', async () => {
    const { tool, run, asked } = setup(false)
    await expect(tool({ platform: 'cloudflare', args: ['deploy'] }, {})).rejects.toThrow('declined')
    expect(asked[0]).toBe('Run wrangler deploy with your cloudflare account, in /tmp/shop.')
    expect(run).not.toHaveBeenCalled()
    const approved = setup(true)
    await approved.tool({ platform: 'cloudflare', args: ['deploy'] }, {})
    expect(approved.run).toHaveBeenCalled()
  })

  it('refuses sign-in and token arguments, a missing credential and a plugin that is not installed', async () => {
    const { tool, run } = setup(true)
    await expect(tool({ platform: 'cloudflare', args: ['login'] }, {})).rejects.toThrow('Sign-in is the person’s')
    await expect(tool({ platform: 'cloudflare', args: ['deploy', '--api-token=x'] }, {})).rejects.toThrow(
      'Leave it out',
    )
    await expect(tool({ platform: 'railway', args: ['status'] }, {})).rejects.toThrow('No installed plugin')
    expect(run).not.toHaveBeenCalled()
    const unsaved = setup(true, null)
    await expect(unsaved.tool({ platform: 'cloudflare', args: ['whoami'] }, {})).rejects.toThrow(
      'API token for cloudflare is not saved',
    )
    expect(unsaved.run).not.toHaveBeenCalled()
  })

  it('runs a local tool with no credential, asking without naming an account', async () => {
    const godot: PluginCliTarget = {
      plugin: 'godot',
      pluginId: 'p2',
      cli: { binaries: ['godot'], reads: [['--version']] },
    }
    const { tool, run, asked, secretOf } = setup(true, null, godot)
    await tool({ platform: 'godot', args: ['--version'] }, {})
    expect(run).toHaveBeenCalledWith(godot, ['--version'], '/tmp/shop', null, undefined)
    await tool({ platform: 'godot', args: ['--headless', '--export-release', 'Web', 'build/web/index.html'] }, {})
    expect(asked).toEqual(['Run godot --headless --export-release Web build/web/index.html in /tmp/shop.'])
    expect(secretOf).not.toHaveBeenCalled()
  })

  it('reports a failed command as an error result', async () => {
    const { tool, run } = setup(true)
    run.mockResolvedValueOnce({ exitCode: 1, output: 'Error: no project', timedOut: false })
    expect((await tool({ platform: 'cloudflare', args: ['deploy'] }, {})).isError).toBe(true)
  })
})

describe('plugin CLIs', () => {
  it('treats only the listed prefixes as reads', () => {
    expect(cliCommandReads(cli, ['d1', 'list', '--json'])).toBe(true)
    expect(cliCommandReads(cli, ['d1'])).toBe(false)
    expect(cliCommandReads(cli, ['d1', 'delete', 'db'])).toBe(false)
    expect(cliCommandReads({ reads: [] }, ['whoami'])).toBe(false)
  })

  it('uses the installed CLI, else its package through npx, else none', () => {
    const fly = { binaries: ['fly', 'flyctl'] }
    expect(cliCommand(fly, (name) => (name === 'flyctl' ? '/bin/flyctl' : null))).toEqual({
      executable: '/bin/flyctl',
      prefix: [],
    })
    expect(cliCommand(cli, (name) => (name === 'npx' ? '/bin/npx' : null))).toEqual({
      executable: '/bin/npx',
      prefix: ['--yes', 'wrangler@4'],
    })
    expect(cliCommand(fly, (name) => (name === 'npx' ? '/bin/npx' : null))).toBeNull()
  })

  it('sets the token and each saved field under their own variables', () => {
    expect(credentialEnvironment(slot, secret)).toEqual({
      CLOUDFLARE_API_TOKEN: 'tok_secret',
      CLOUDFLARE_ACCOUNT_ID: 'acc_1',
    })
    expect(credentialEnvironment(slot, { ...secret, fields: {} })).toEqual({ CLOUDFLARE_API_TOKEN: 'tok_secret' })
  })

  it('never returns a secret value, and keeps the end of a long output', () => {
    expect(cliOutput('\u001b[32mdeployed\u001b[0m with tok_secret on acc_1', ['tok_secret', 'acc_1'])).toBe(
      'deployed with [token] on [token]',
    )
    const long = cliOutput(`${'a'.repeat(60_000)}END`, ['xxxx'])
    expect(long.startsWith('…')).toBe(true)
    expect(long.endsWith('END')).toBe(true)
  })
})
