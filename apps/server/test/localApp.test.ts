import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { TunnelChoice } from '@ramu/shared/types'
import { LocalApps, localAppName, localRunArgs, type LocalRun } from '../src/workspace/deploy/localApp'
import type { TunnelManager } from '../src/remote/tunnel'

function setup(choice: TunnelChoice = { kind: 'quick' }, docker = true) {
  const order: string[] = []
  const calls: { argv: string[]; input?: string }[] = []
  const run = vi.fn<LocalRun>(async (argv, options) => {
    calls.push({ argv, ...(options?.input !== undefined ? { input: options.input } : {}) })
    order.push(argv.slice(0, 2).join(' '))
    if (argv[1] === 'version' && !docker) throw new Error('Cannot connect to the Docker daemon')
    return ''
  })
  const use = vi.fn()
  const tunnel = {
    use,
    stop: vi.fn(() => order.push('tunnel stop')),
    status: () => ({ state: 'running', url: 'https://app.trycloudflare.com', error: null }),
    address: () => 'https://app.trycloudflare.com',
  } as unknown as TunnelManager
  let saved: Record<string, string> = {}
  const apps = new LocalApps({
    run,
    tunnels: () => tunnel,
    saved: { read: () => ({ ...saved }), write: (next) => void (saved = next) },
    choice: () => choice,
    freePort: async () => 41234,
  })
  return { apps, calls, use, order, saved: () => saved }
}

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'ramu-local-'))
  writeFileSync(join(root, 'index.html'), '<h1>Hi</h1>')
  return root
}

describe('apps published from this computer', () => {
  it('names containers safely and publishes only the app’s port, on loopback, with privileges dropped', () => {
    expect(localAppName('Ramu: Demo/Site')).toBe('ramu-local-ramu-demo-site')
    expect(localRunArgs('ramu-local-x', 41234, 8080)).toEqual([
      'docker',
      'run',
      '--detach',
      '--name',
      'ramu-local-x',
      '--restart',
      'no',
      '--security-opt',
      'no-new-privileges',
      '--publish',
      '127.0.0.1:41234:8080',
      'ramu-local-x',
    ])
  })

  it('builds with a Dockerfile Ramu writes, runs it and points a tunnel of its own at that port alone', async () => {
    const { apps, calls, use, saved } = setup()
    const root = project()
    const status = await apps.publish('demo', root)
    expect(status).toMatchObject({ state: 'running', url: 'https://app.trycloudflare.com' })
    const build = calls.find((call) => call.argv[1] === 'build')!
    expect(build.argv).toEqual(['docker', 'build', '--tag', 'ramu-local-demo', '--file', '-', '.'])
    expect(build.input).toContain('EXPOSE 8080')
    expect(calls.some((call) => call.argv.join(' ').includes('--publish 127.0.0.1:41234:8080'))).toBe(true)
    expect(use).toHaveBeenCalledWith({ kind: 'quick' }, 'http://127.0.0.1:41234')
    expect(saved()).toEqual({ demo: root })
  })

  it('uses the project’s own Dockerfile and its EXPOSE port', async () => {
    const { apps, calls } = setup()
    const root = project()
    writeFileSync(join(root, 'Dockerfile'), 'FROM nginx\nEXPOSE 80\n')
    await apps.publish('demo', root)
    expect(calls.find((call) => call.argv[1] === 'build')?.argv).toEqual([
      'docker',
      'build',
      '--tag',
      'ramu-local-demo',
      '--file',
      'Dockerfile',
      '.',
    ])
    expect(calls.some((call) => call.argv.includes('127.0.0.1:41234:80'))).toBe(true)
  })

  it('takes the app off the internet before stopping its container', async () => {
    const { apps, order, saved } = setup()
    await apps.publish('demo', project())
    order.length = 0
    await apps.stop('demo')
    expect(order).toEqual(['tunnel stop', 'docker rm'])
    expect(saved()).toEqual({})
    expect(apps.status('demo').state).toBe('off')
  })

  it('refuses without Docker, and refuses tunnels that would serve under this computer’s own name', async () => {
    await expect(setup({ kind: 'quick' }, false).apps.publish('demo', project())).rejects.toThrow('Docker must be')
    await expect(setup({ kind: 'tailscale' }).apps.publish('demo', project())).rejects.toThrow('Tailscale Funnel')
    await expect(setup({ kind: 'ngrok', domain: 'me.ngrok.app' }).apps.publish('demo', project())).rejects.toThrow(
      'fixed ngrok domain',
    )
  })
})
