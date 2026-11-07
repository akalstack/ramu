import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { TunnelChoice } from '@ramu/shared/types'
import {
  LocalApps,
  localAppName,
  localRunArgs,
  type LocalProcess,
  type LocalRun,
  type SavedApp,
} from '../src/workspace/deploy/localApp'
import type { TunnelManager } from '../src/remote/tunnel'

function setup(choice: TunnelChoice = { kind: 'quick' }, docker = true, listens = true) {
  const started: { argv: string[]; cwd: string; env: Record<string, string> }[] = []
  let exit: (output: string) => void = () => {}
  const program: LocalProcess = { stop: vi.fn(), exited: new Promise((resolve) => (exit = resolve)) }
  const order: string[] = []
  const calls: { argv: string[]; input?: string; env?: Record<string, string> }[] = []
  const run = vi.fn<LocalRun>(async (argv, options) => {
    calls.push({
      argv,
      ...(options?.input !== undefined ? { input: options.input } : {}),
      ...(options?.env ? { env: options.env } : {}),
    })
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
  let saved: Record<string, SavedApp> = {}
  const apps = new LocalApps({
    run,
    tunnels: () => tunnel,
    saved: { read: () => ({ ...saved }), write: (next) => void (saved = next) },
    choice: () => choice,
    freePort: async () => 41234,
    start: (argv, options) => {
      started.push({ argv, ...options })
      return program
    },
    listening: async () => {
      if (!listens) throw new Error('The app did not start listening on port 41234.')
    },
  })
  return { apps, calls, use, order, saved: () => saved, started, program, exit }
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
    expect(saved()).toEqual({ demo: { root, mode: 'container' } })
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

  it('passes the app’s own variables by name, with values only in docker’s environment', async () => {
    const { apps, calls } = setup()
    await apps.start(async () => ({ DATABASE_URL: 'postgres://secret', PATH: '/evil' }))
    await apps.publish('demo', project())
    const started = calls.find((call) => call.argv[1] === 'run')!
    expect(started.argv).toContain('DATABASE_URL')
    expect(started.argv.join(' ')).not.toContain('postgres://secret')
    expect(started.argv).not.toContain('PATH')
    expect(started.env).toEqual({ DATABASE_URL: 'postgres://secret' })
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

  it('runs a Node app without Docker as a program on a loopback port, with only its own variables, when asked', async () => {
    const { apps, calls, use, started, program, saved, exit } = setup({ kind: 'quick' }, false)
    const root = project()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'next build', start: 'next start' } }))
    writeFileSync(join(root, 'pnpm-lock.yaml'), '')
    ;(apps as unknown as { variables: () => Promise<Record<string, string>> }).variables = async () => ({
      API_KEY: 'k',
      PORT: '9999',
      PATH: '/evil',
    })
    const status = await apps.publish('demo', root, 'process')
    expect(status).toMatchObject({ state: 'running', mode: 'process' })
    expect(calls.map((call) => call.argv)).toEqual([
      ['pnpm', 'install'],
      ['pnpm', 'run', 'build'],
    ])
    expect(started[0]!.argv).toEqual(['pnpm', 'run', 'start'])
    expect(started[0]!.env).toMatchObject({ API_KEY: 'k', PORT: '41234', HOST: '127.0.0.1', NODE_ENV: 'production' })
    expect(started[0]!.env.PATH).not.toBe('/evil')
    expect(use).toHaveBeenCalledWith({ kind: 'quick' }, 'http://127.0.0.1:41234')
    expect(saved()).toEqual({ demo: { root, mode: 'process' } })
    // A program that stops takes its address down and says why.
    exit('Error: listen EADDRINUSE')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(apps.status('demo')).toMatchObject({ state: 'failed', error: 'Error: listen EADDRINUSE' })
    await apps.stop('demo')
    expect(program.stop).toHaveBeenCalled()
    expect(saved()).toEqual({})
  })

  it('refuses an app without a start script, and fails when nothing answers on the port', async () => {
    const plain = setup({ kind: 'quick' }, false)
    await expect(plain.apps.publish('demo', project(), 'process')).rejects.toThrow('start script')
    const silent = setup({ kind: 'quick' }, false, false)
    const root = project()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }))
    const status = await silent.apps.publish('demo', root, 'process')
    expect(status).toMatchObject({ state: 'failed', error: 'The app did not start listening on port 41234.' })
    expect(silent.program.stop).toHaveBeenCalled()
    expect(silent.calls.map((call) => call.argv)).toEqual([['npm', 'install']])
  })

  it('runs an app with a lasting address at its fixed port, behind its hostname instead of a quick tunnel', async () => {
    const { calls } = setup()
    const root = project()
    const apps = new LocalApps({
      run: async (argv) => {
        calls.push({ argv })
        return ''
      },
      tunnels: () => {
        throw new Error('no quick tunnel for a lasting address')
      },
      saved: { read: () => ({}), write: () => {} },
      choice: () => ({ kind: 'tailscale' }),
      freePort: async () => 1,
      addresses: {
        address: async () => ({ hostname: 'demo.example.com', port: 5555, tunnelToken: 't' }),
        hostname: () => 'demo.example.com',
        set: async () => ({ hostname: 'demo.example.com', port: 5555 }),
        remove: async () => {},
      },
    })
    const status = await apps.publish('demo', root)
    expect(calls.find((call) => call.argv[1] === 'run')?.argv.some((arg) => arg.startsWith('127.0.0.1:5555:'))).toBe(
      true,
    )
    expect(status).toMatchObject({ url: 'https://demo.example.com', lasting: 'demo.example.com' })
    apps.close()
  })
})
