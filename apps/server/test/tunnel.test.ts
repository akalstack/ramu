import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { CloudflareTunnel, quickTunnelUrl, validateTunnelSetting } from '../src/remote/tunnel'

function fakeProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  })
  return child
}

function tunnel(token: string | null = null) {
  const children: ReturnType<typeof fakeProcess>[] = []
  const spawned: { args: string[]; env: NodeJS.ProcessEnv }[] = []
  const listen = vi.fn(async () => {})
  const unlisten = vi.fn()
  const instance = new CloudflareTunnel({
    binDir: '/unused',
    listen,
    unlisten,
    token: async () => token,
    changed: () => {},
    resolveBinary: async () => '/bin/cloudflared',
    spawnProcess: ((_binary: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
      spawned.push({ args, env: options.env })
      const child = fakeProcess()
      children.push(child)
      return child
    }) as never,
  })
  return { instance, children, spawned, listen, unlisten }
}

it('reads the quick tunnel address from cloudflared’s log', () => {
  expect(quickTunnelUrl('INF |  https://calm-river-1a2b.trycloudflare.com  |')).toBe(
    'https://calm-river-1a2b.trycloudflare.com',
  )
  expect(quickTunnelUrl('INF Starting tunnel')).toBeNull()
})

it('validates settings and requires a hostname for a named tunnel', () => {
  expect(validateTunnelSetting({ mode: 'quick' })).toEqual({ mode: 'quick', hostname: null, originPort: 7789 })
  expect(validateTunnelSetting({ mode: 'named', hostname: 'https://Ramu.Example.com/' }).hostname).toBe(
    'ramu.example.com',
  )
  expect(() => validateTunnelSetting({ mode: 'named' })).toThrow('public hostname')
  expect(() => validateTunnelSetting({ mode: 'quick', originPort: 80 })).toThrow('port')
})

it('starts a quick tunnel on the loopback origin and reports its address', async () => {
  const t = tunnel()
  await t.instance.apply({ mode: 'quick', hostname: null, originPort: 7789 })
  expect(t.listen).toHaveBeenCalledWith(7789)
  expect(t.spawned[0]!.args).toEqual(['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:7789'])
  expect(t.instance.address()).toBeNull()
  t.children[0]!.stderr.write('INF Your quick Tunnel: https://a-b-c.trycloudflare.com\n')
  expect(t.instance.status()).toMatchObject({ state: 'running', url: 'https://a-b-c.trycloudflare.com' })
  t.instance.stop()
  expect(t.children[0]!.kill).toHaveBeenCalled()
  expect(t.unlisten).toHaveBeenCalled()
  expect(t.instance.status().state).toBe('off')
})

it('passes a named tunnel’s token through the environment, never the arguments', async () => {
  const t = tunnel('eyJhIjoiYiJ9-token-value')
  await t.instance.apply({ mode: 'named', hostname: 'ramu.example.com', originPort: 7789 })
  expect(t.spawned[0]!.args).toEqual(['tunnel', '--no-autoupdate', 'run'])
  expect(t.spawned[0]!.env.TUNNEL_TOKEN).toBe('eyJhIjoiYiJ9-token-value')
  t.children[0]!.stderr.write('INF Registered tunnel connection connIndex=0\n')
  expect(t.instance.address()).toBe('https://ramu.example.com')
  t.instance.stop()
})

it('asks for the token before starting a named tunnel without one', async () => {
  const t = tunnel(null)
  await t.instance.apply({ mode: 'named', hostname: 'ramu.example.com', originPort: 7789 })
  expect(t.instance.status()).toMatchObject({ state: 'error', error: expect.stringContaining('token') })
  expect(t.spawned).toHaveLength(0)
})

it('reports why cloudflared stopped and restarts it', async () => {
  vi.useFakeTimers()
  try {
    const t = tunnel()
    await t.instance.apply({ mode: 'quick', hostname: null, originPort: 7789 })
    t.children[0]!.stderr.write('2026-11-02T00:00:00Z ERR failed to connect to the edge\n')
    t.children[0]!.emit('exit', 1)
    expect(t.instance.status()).toMatchObject({ state: 'error', error: 'failed to connect to the edge' })
    await vi.advanceTimersByTimeAsync(2500)
    expect(t.spawned).toHaveLength(2)
    t.instance.stop()
  } finally {
    vi.useRealTimers()
  }
})
