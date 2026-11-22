import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { parseTunnelChoice, tunnelCommand, tunnelUrl, TunnelManager } from '../src/remote/tunnel'

afterEach(() => vi.useRealTimers())

/** A stand-in for the tool's process: lines can be written to its output, and it can exit. */
function fakeProcess() {
  const child = new EventEmitter() as ChildProcess & EventEmitter
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  Object.assign(child, { stdout, stderr, kill: vi.fn() })
  return { child, say: (line: string) => stderr.write(`${line}\n`), exit: () => child.emit('exit', 1) }
}

it('runs each tool in the foreground toward this host’s listener', () => {
  expect(tunnelCommand({ kind: 'quick' }, 'http://127.0.0.1:7788')).toEqual([
    'tunnel',
    '--no-autoupdate',
    '--url',
    'http://127.0.0.1:7788',
  ])
  expect(tunnelCommand({ kind: 'tailscale' }, 'https://127.0.0.1:7788')).toEqual([
    'funnel',
    'https+insecure://127.0.0.1:7788',
  ])
  expect(tunnelCommand({ kind: 'ngrok', domain: 'me.ngrok-free.app' }, 'http://127.0.0.1:7788')).toContain(
    'https://me.ngrok-free.app',
  )
})

it('reads the public address from each tool’s output', () => {
  expect(tunnelUrl('quick', '|  https://quiet-river-1234.trycloudflare.com  |')).toBe(
    'https://quiet-river-1234.trycloudflare.com',
  )
  expect(tunnelUrl('tailscale', 'Available on the internet: https://studio.tail1234.ts.net/')).toBe(
    'https://studio.tail1234.ts.net',
  )
  expect(tunnelUrl('ngrok', '{"lvl":"info","msg":"started tunnel","url":"https://me.ngrok-free.app"}')).toBe(
    'https://me.ngrok-free.app',
  )
  expect(tunnelUrl('quick', 'INF Starting tunnel')).toBeNull()
})

it('accepts only known tunnels and a plain ngrok domain', () => {
  expect(parseTunnelChoice(null)).toBeNull()
  expect(parseTunnelChoice({ kind: 'ngrok', domain: 'https://Me.ngrok-free.app/' })).toEqual({
    kind: 'ngrok',
    domain: 'me.ngrok-free.app',
  })
  expect(parseTunnelChoice({ kind: 'quick', domain: 'ignored.example' })).toEqual({ kind: 'quick' })
  expect(() => parseTunnelChoice({ kind: 'ssh' })).toThrow()
  expect(() => parseTunnelChoice({ kind: 'ngrok', domain: 'not a domain' })).toThrow(/ngrok domain/)
})

it('takes the tunnel’s address once it is up, and starts it again when it ends on its own', () => {
  vi.useFakeTimers()
  const runs: ReturnType<typeof fakeProcess>[] = []
  const changed = vi.fn()
  const tunnels = new TunnelManager({
    changed,
    find: (command) => `/usr/local/bin/${command}`,
    run: () => {
      runs.push(fakeProcess())
      return runs.at(-1)!.child
    },
  })
  tunnels.use({ kind: 'quick' }, 'http://127.0.0.1:7788')
  expect(tunnels.status().state).toBe('starting')
  expect(tunnels.address()).toBeNull()
  runs[0]!.say('INF |  https://quiet-river-1234.trycloudflare.com  |')
  return vi
    .waitFor(() => expect(tunnels.address()).toBe('https://quiet-river-1234.trycloudflare.com'))
    .then(() => {
      expect(changed).toHaveBeenCalled()
      runs[0]!.say('ERR failed to connect to the edge')
      runs[0]!.exit()
      expect(tunnels.address()).toBeNull()
      expect(tunnels.status()).toMatchObject({ state: 'failed', error: expect.stringContaining('failed to connect') })
      vi.advanceTimersByTime(3_000)
      expect(runs).toHaveLength(2)
      tunnels.stop()
      expect(runs[1]!.child.kill).toHaveBeenCalled()
    })
})

it('says which tool to install instead of failing to start it', () => {
  const tunnels = new TunnelManager({ find: () => null })
  tunnels.use({ kind: 'tailscale' }, 'http://127.0.0.1:7788')
  expect(tunnels.status()).toMatchObject({
    state: 'missing',
    tools: { cloudflared: false, tailscale: false, ngrok: false },
  })
})

it('resolves Stop once the tool has exited, and kills a tool that does not exit', async () => {
  vi.useFakeTimers()
  const child = new EventEmitter() as ChildProcess & EventEmitter
  Object.assign(child, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => true),
  })
  const tunnels = new TunnelManager({ find: (command) => `/usr/local/bin/${command}`, run: () => child })
  tunnels.use({ kind: 'quick' }, 'http://127.0.0.1:7788')
  let stopped = false
  const stopping = tunnels.stop().then(() => (stopped = true))
  expect(child.kill).toHaveBeenCalledWith()
  await vi.advanceTimersByTimeAsync(4_999)
  expect(stopped).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(child.kill).toHaveBeenLastCalledWith('SIGKILL')
  child.emit('exit', null, 'SIGKILL')
  await stopping
  expect(stopped).toBe(true)
  expect(tunnels.status().state).toBe('off')
})

it('runs Ramu Link with the relay’s token out of the process list, and is up once cloudflared registers', async () => {
  const runs: { args: string[]; env?: Record<string, string>; process: ReturnType<typeof fakeProcess> }[] = []
  const tunnels = new TunnelManager({
    find: (command) => `/usr/local/bin/${command}`,
    run: (_file, args, env) => {
      runs.push({ args, env, process: fakeProcess() })
      return runs.at(-1)!.process.child
    },
    lease: async (relay, target) =>
      relay === undefined && target === 'http://127.0.0.1:7788'
        ? { token: 'tok', url: 'https://ramu-abc.akalstack.com' }
        : null,
  })
  tunnels.use({ kind: 'link' }, 'http://127.0.0.1:7788')
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  expect(runs[0]!.args).toEqual(['tunnel', '--no-autoupdate', 'run'])
  expect(runs[0]!.args.join(' ')).not.toContain('tok')
  expect(runs[0]!.env).toEqual({ TUNNEL_TOKEN: 'tok' })
  expect(tunnels.address()).toBeNull()
  runs[0]!.process.say('INF Registered tunnel connection connIndex=0')
  await vi.waitFor(() => expect(tunnels.address()).toBe('https://ramu-abc.akalstack.com'))
  tunnels.relinked(null)
  expect(tunnels.status().state).toBe('off')
  expect(runs[0]!.process.child.kill).toHaveBeenCalled()
})

it('waits without a tunnel while Ramu Link has no slot for this host', async () => {
  const run = vi.fn()
  const tunnels = new TunnelManager({ find: (command) => `/usr/local/bin/${command}`, run, lease: async () => null })
  tunnels.use({ kind: 'link' }, 'http://127.0.0.1:7788')
  await vi.waitFor(() => expect(tunnels.status().state).toBe('off'))
  expect(run).not.toHaveBeenCalled()
})

it('takes Ramu Link with Ramu’s relay or the person’s own', () => {
  expect(parseTunnelChoice({ kind: 'link' })).toEqual({ kind: 'link' })
  expect(parseTunnelChoice({ kind: 'link', relay: 'https://ramu-link.akalstack.com' })).toEqual({ kind: 'link' })
  expect(parseTunnelChoice({ kind: 'link', relay: 'https://relay.example.com/' })).toEqual({
    kind: 'link',
    relay: 'https://relay.example.com',
  })
  expect(() => parseTunnelChoice({ kind: 'link', relay: 'ftp://x' })).toThrow()
})
