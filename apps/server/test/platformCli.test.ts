import { describe, expect, it, vi } from 'vitest'
import {
  CLI_PLATFORM_SPECS,
  cliCommand,
  cliCommandReads,
  cliOutput,
  flyAuthorization,
} from '../src/workspace/deploy/cliPlatforms'
import { registerPlatformCliTools } from '../src/workspace/deploy/tools'

type Handler = (args: Record<string, unknown>, extra: { signal?: AbortSignal }) => Promise<{ isError?: boolean }>

function setup(approve: boolean, connected = true) {
  const tools = new Map<string, Handler>()
  const server = { registerTool: (name: string, _def: unknown, handler: Handler) => void tools.set(name, handler) }
  const accounts = {
    connected: vi.fn(() => connected),
    auth: vi.fn(async () => ({ auth: { token: 'tok_secret' }, accountId: 'acc_1', defaultScope: 'acc_1' })),
  }
  const asked: string[] = []
  const source = { id: 's1', parentId: null, cwd: '/tmp/shop', settings: { access: 'full' } }
  const run = vi.fn(async () => ({ exitCode: 0, output: 'ok', timedOut: false }))
  registerPlatformCliTools(
    server as never,
    accounts as never,
    source as never,
    () => source as never,
    async (detail) => {
      asked.push(detail)
      return approve
    },
    run,
  )
  return { tool: tools.get('platform_cli')!, run, asked, accounts }
}

describe('platform_cli', () => {
  it('runs a command that only reads without asking, in the thread’s checkout with the saved token', async () => {
    const { tool, run, asked } = setup(false)
    await tool({ platform: 'fly', args: ['status', '--json'] }, {})
    expect(asked).toEqual([])
    expect(run).toHaveBeenCalledWith(
      'fly',
      ['status', '--json'],
      '/tmp/shop',
      { token: 'tok_secret', accountId: 'acc_1' },
      undefined,
    )
  })

  it('asks with a card naming any other command, and runs nothing when refused', async () => {
    const { tool, run, asked } = setup(false)
    await expect(tool({ platform: 'railway', args: ['up', '--detach'] }, {})).rejects.toThrow('declined')
    expect(asked[0]).toBe('Run railway up --detach on your Railway account, in /tmp/shop.')
    expect(run).not.toHaveBeenCalled()
    const approved = setup(true)
    await approved.tool({ platform: 'railway', args: ['up', '--detach'] }, {})
    expect(approved.run).toHaveBeenCalled()
  })

  it('refuses sign-in and token arguments, and a platform that is not connected', async () => {
    const { tool, run } = setup(true)
    await expect(tool({ platform: 'cloudflare', args: ['login'] }, {})).rejects.toThrow('Sign-in is the person’s')
    await expect(tool({ platform: 'fly', args: ['deploy', '--access-token=x'] }, {})).rejects.toThrow('Leave it out')
    expect(run).not.toHaveBeenCalled()
    await expect(setup(true, false).tool({ platform: 'supabase', args: ['projects', 'list'] }, {})).rejects.toThrow(
      'Supabase is not connected',
    )
  })

  it('reports a failed command as an error result', async () => {
    const { tool, run } = setup(true)
    run.mockResolvedValueOnce({ exitCode: 1, output: 'Error: no app', timedOut: false })
    expect((await tool({ platform: 'fly', args: ['deploy'] }, {})).isError).toBe(true)
  })
})

describe('platform CLIs', () => {
  it('treats only the listed prefixes as reads', () => {
    expect(cliCommandReads('fly', ['logs', '--no-tail', '-a', 'shop'])).toBe(true)
    expect(cliCommandReads('fly', ['logs'])).toBe(false)
    expect(cliCommandReads('cloudflare', ['d1', 'list'])).toBe(true)
    expect(cliCommandReads('cloudflare', ['d1', 'delete', 'db'])).toBe(false)
    expect(cliCommandReads('railway', ['variables'])).toBe(false)
    expect(cliCommandReads('supabase', ['--help'])).toBe(true)
  })

  it('uses the installed CLI, else its package through npx, else none', () => {
    expect(cliCommand('fly', (name) => (name === 'flyctl' ? '/bin/flyctl' : null))).toEqual({
      executable: '/bin/flyctl',
      prefix: [],
    })
    expect(cliCommand('cloudflare', (name) => (name === 'npx' ? '/bin/npx' : null))).toEqual({
      executable: '/bin/npx',
      prefix: ['--yes', 'wrangler@4'],
    })
    expect(cliCommand('fly', (name) => (name === 'npx' ? '/bin/npx' : null))).toBeNull()
  })

  it('never returns the token, and keeps the end of a long output', () => {
    expect(cliOutput('\u001b[32mdeployed\u001b[0m with tok_secret', 'tok_secret')).toBe('deployed with [token]')
    const long = cliOutput(`${'a'.repeat(60_000)}END`, 'x')
    expect(long.startsWith('…')).toBe(true)
    expect(long.endsWith('END')).toBe(true)
  })

  it('sends Fly.io macaroons after FlyV1 and a user token after Bearer', () => {
    expect(flyAuthorization('FlyV1 fm2_abc,fm2_def')).toBe('FlyV1 fm2_abc,fm2_def')
    expect(flyAuthorization('fo1_user')).toBe('Bearer fo1_user')
  })

  it('names the account a token belongs to, and refuses one the platform rejects', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/user/tokens/verify')) return Response.json({ result: { status: 'active' } })
      return Response.json({ result: [{ id: 'acc_1', name: 'Ana' }] })
    })
    expect(await CLI_PLATFORM_SPECS.cloudflare.account({ token: 't' }, fetcher as never)).toMatchObject({
      id: 'acc_1',
      name: 'Ana',
      defaultScope: 'acc_1',
    })
    const refused = vi.fn(async () => new Response('{}', { status: 401 }))
    await expect(CLI_PLATFORM_SPECS.supabase.account({ token: 't' }, refused as never)).rejects.toThrow(
      'refused the saved sign-in',
    )
  })
})
