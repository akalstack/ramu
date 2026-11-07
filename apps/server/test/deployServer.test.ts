// The own-server pieces around the adapter: the deploy job the pull request adds, the SSH helpers (keys, pinned host
// keys, the remote command line) and connecting a server, all without a real server or network.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { serverAppName, serverWorkflow, SERVER_DEPLOY_SCRIPT, SERVER_SECRETS } from '@ramu/shared/serverDeploy'
import { HostCredentialStore } from '../src/credentials/store'
import { HostingAccounts } from '../src/workspace/deploy/accounts'
import { serverAdapter, serverConnection } from '../src/workspace/deploy/server'
import { ServerSetup } from '../src/workspace/deploy/serverSetup'
import type { DeployService } from '../src/workspace/deploy/service'
import {
  generateKeyPair,
  hostKeyFingerprint,
  readPrivateKey,
  remoteCommand,
  sshFailure,
  sshHost,
  type SshRunner,
  type SshTarget,
} from '../src/workspace/deploy/ssh'

describe('serverWorkflow', () => {
  const workflow = serverWorkflow({ app: serverAppName('Ana/My_Shop'), defaultBranch: 'main', afterCi: true })
  const parsed = parse(workflow) as {
    on: Record<string, unknown>
    permissions: Record<string, string>
    jobs: { deploy: { steps: { uses?: string; env?: Record<string, string>; run?: string }[] } }
  }

  it('runs after CI passes on the default branch, and on dispatch with an earlier commit to put back', () => {
    expect(parsed.on.workflow_run).toEqual({ workflows: ['CI'], types: ['completed'], branches: ['main'] })
    expect(parsed.on.workflow_dispatch).toMatchObject({ inputs: { tag: { required: false } } })
    const push = parse(serverWorkflow({ app: 'a', defaultBranch: 'main', afterCi: false })) as typeof parsed
    expect(push.on.push).toEqual({ branches: ['main'] })
  })

  it('grants only reading the code and writing packages, with actions pinned to a major version', () => {
    expect(parsed.permissions).toEqual({ contents: 'read', packages: 'write' })
    for (const step of parsed.jobs.deploy.steps.filter((entry) => entry.uses))
      expect(step.uses).toMatch(/^[\w-]+\/[\w-]+@v\d+$/)
  })

  it('reads the SSH details from repository secrets and never writes a value into the file', () => {
    const restart = parsed.jobs.deploy.steps.at(-1)!
    expect(Object.values(restart.env!)).toEqual(
      expect.arrayContaining(Object.values(SERVER_SECRETS).map((name) => `\${{ secrets.${name} }}`)),
    )
    expect(restart.env!.APP).toBe('ana-my-shop')
    expect(restart.env!.DEPLOY_SCRIPT?.trim()).toBe(SERVER_DEPLOY_SCRIPT)
    expect(restart.run).toContain('StrictHostKeyChecking=yes')
  })

  it('sends a script the server’s shell can take as one single-quoted argument', () => {
    expect(SERVER_DEPLOY_SCRIPT).not.toContain("'")
    expect(SERVER_DEPLOY_SCRIPT).toContain('Put $current back.')
  })
})

const FIXTURE_KEY = 'AAAAC3NzaC1lZDI1NTE5AAAAIPVMG+ElpEM04bD0eMCEH8mLSZUO4Dp0Z2tRy1K4/+0S'

describe('the deploy script on the server', () => {
  // Stand-ins for docker and sleep: docker logs each call, and the app answers its health path with $CODE.
  const run = (code: string) => {
    const home = mkdtempSync(join(tmpdir(), 'ramu-deploy-'))
    const bin = join(home, 'bin')
    mkdirSync(bin)
    const app = join(home, 'ramu/apps/shop')
    mkdirSync(app, { recursive: true })
    writeFileSync(join(app, 'port'), '3000\n')
    writeFileSync(join(app, 'health'), '/api/health\n')
    writeFileSync(join(app, 'image'), 'ghcr.io/me/shop:old\n')
    writeFileSync(
      join(bin, 'docker'),
      [
        '#!/bin/sh',
        'echo "$*" >> "$HOME/calls"',
        'case "$1 $2" in',
        '  "inspect -f") echo "true 0";;',
        '  "exec ramu-caddy") echo "  HTTP/1.1 $CODE Status" >&2; [ "$CODE" -lt 400 ];;',
        'esac',
        'exit 0',
      ].join('\n'),
    )
    writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n')
    chmodSync(join(bin, 'docker'), 0o755)
    chmodSync(join(bin, 'sleep'), 0o755)
    const b64 = (value: string) => `v${Buffer.from(value).toString('base64')}`
    let failed = ''
    try {
      execFileSync('sh', ['-c', SERVER_DEPLOY_SCRIPT, 'ramu', b64('shop'), b64('ghcr.io/me/shop:new'), b64('me')], {
        env: { HOME: home, PATH: `${bin}:${process.env.PATH}`, CODE: code },
        input: '',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      failed = String((error as { stderr?: Buffer }).stderr ?? error)
    }
    return { failed, calls: readFileSync(join(home, 'calls'), 'utf8'), image: readFileSync(join(app, 'image'), 'utf8') }
  }

  it('keeps the new version once it answers its health path through Caddy, even with a sign-in page', () => {
    const { failed, calls, image } = run('401')
    expect(failed).toBe('')
    expect(calls).toContain('exec ramu-caddy wget -S -q -T 5 -O /dev/null http://ramu-shop:3000/api/health')
    expect(image).toBe('ghcr.io/me/shop:new\n')
  })

  it('puts the previous version back when the new one keeps failing its health path', () => {
    const { failed, calls, image } = run('502')
    expect(failed).toContain('did not answer at /api/health')
    expect(failed).toContain('Put ghcr.io/me/shop:old back.')
    expect(calls).toMatch(/run -d --name ramu-shop .* ghcr.io\/me\/shop:old/)
    expect(image).toBe('ghcr.io/me/shop:old\n')
  })
})

describe('SSH helpers', () => {
  it('creates an ed25519 key pair in OpenSSH’s own formats', () => {
    const { privateKey, publicKey } = generateKeyPair('ramu')
    expect(privateKey).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----\n[\s\S]+\n-----END OPENSSH PRIVATE KEY-----\n$/)
    expect(publicKey).toMatch(/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI\S+ ramu$/)
    // The pasted-key reader finds the same public half inside the private key.
    expect(readPrivateKey(privateKey).publicKey).toBe(publicKey.replace(/ ramu$/, ''))
    expect(generateKeyPair().privateKey).not.toBe(privateKey)
  })

  it('refuses keys it cannot use without a passphrase, and text that is not a key', () => {
    const encrypted = Buffer.concat([
      Buffer.from('openssh-key-v1\0'),
      Buffer.from([0, 0, 0, 10]),
      Buffer.from('aes256-ctr'),
    ]).toString('base64')
    expect(() =>
      readPrivateKey(`-----BEGIN OPENSSH PRIVATE KEY-----\n${encrypted}\n-----END OPENSSH PRIVATE KEY-----`),
    ).toThrow(/passphrase/)
    expect(() =>
      readPrivateKey('-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nabc\n-----END RSA PRIVATE KEY-----'),
    ).toThrow(/passphrase/)
    expect(readPrivateKey('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----').publicKey).toBeNull()
    expect(() => readPrivateKey('ssh-ed25519 AAAA… my public key')).toThrow(/whole private key/)
  })

  it('prints a pinned key’s fingerprint as ssh-keygen does', () => {
    expect(hostKeyFingerprint(`203.0.113.10 ssh-ed25519 ${FIXTURE_KEY}\n`)).toBe(
      'SHA256:KeRVA5QsO0lUKYmtzVyHAAcdStXGYGa7lXQ6ai77mEI',
    )
  })

  it('accepts addresses and host names, never an ssh option', () => {
    expect(sshHost(' 203.0.113.10 ')).toBe('203.0.113.10')
    expect(sshHost('[2001:db8::1]')).toBe('2001:db8::1')
    expect(sshHost('Server.Example.com')).toBe('server.example.com')
    expect(sshHost('-oProxyCommand=touch /tmp/x')).toBeNull()
    expect(sshHost('a b')).toBeNull()
  })

  it('sends values base64-encoded after a fixed script, so no value reaches the shell as text', () => {
    const command = remoteCommand('echo "$1"', ['a; rm -rf ~', '', "it's"])
    expect(command).toBe(
      `sh -c 'echo "$1"' ramu v${Buffer.from('a; rm -rf ~').toString('base64')} v v${Buffer.from("it's").toString('base64')}`,
    )
    expect(command.split("'").length).toBe(3)
    expect(() => remoteCommand("echo 'x'", [])).toThrow()
  })

  it('names a changed host key and a refused key in plain words', () => {
    expect(sshFailure('@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@', 'h')).toMatchObject({
      message: expect.stringMatching(/different server key/),
    })
    expect(sshFailure('deploy@h: Permission denied (publickey).', 'h')).toMatchObject({ kind: 'signed-out' })
  })
})

describe('connecting a server', () => {
  const setup = () => {
    const state = new Map<string, unknown>()
    const vault = new Map<string, string>()
    const credentials = new HostCredentialStore(async (_service, key) => ({
      setPassword: async (value) => void vault.set(key, value),
      getPassword: async () => vault.get(key) ?? null,
      deletePassword: async () => vault.delete(key),
    }))
    const calls: { target: SshTarget; command: string }[] = []
    let serverKey = `ssh-ed25519 ${FIXTURE_KEY}`
    const ssh: SshRunner = async (target, command) => {
      calls.push({ target, command })
      const presented = `${target.host} ${serverKey}`
      // As OpenSSH does: learn the key on first contact, refuse one that differs from the pinned key.
      if (target.knownHosts && target.knownHosts !== presented)
        throw sshFailure('REMOTE HOST IDENTIFICATION HAS CHANGED', target.host)
      return {
        code: 0,
        stdout: command.includes('docker') ? 'docker=ready\nversion=27.1\n' : 'deploy\n',
        stderr: '',
        knownHosts: presented,
      }
    }
    const getState = <T>(key: string, fallback: T) => (state.has(key) ? (state.get(key) as T) : fallback)
    const setState = (key: string, value: unknown) => void state.set(key, value)
    const adapter = serverAdapter({ ssh })
    const accounts = new HostingAccounts(getState, setState, credentials, fetch, {}, () => ({
      name: adapter.name,
      tokenPage: adapter.tokenPage,
      account: (auth) => adapter.account(auth),
      kind: 'hosting',
    }))
    const server = new ServerSetup(
      getState,
      setState,
      accounts,
      {} as DeployService,
      {
        repository: async () => {
          throw new Error('unused')
        },
        actionsSecrets: () => {
          throw new Error('unused')
        },
      },
      credentials,
      ssh,
    )
    return { server, accounts, calls, changeKey: (key: string) => (serverKey = key) }
  }

  it('signs in with a key made on the host, pins the server’s key on first contact and checks Docker', async () => {
    const { server, accounts, calls } = setup()
    const publicKey = await server.createKey()
    // Pressing Create twice shows the same key, so the line already added to the server stays valid.
    expect(await server.createKey()).toBe(publicKey)
    expect((await server.status(false)).pendingKey).toBe(publicKey)
    const status = await server.connect({ host: '203.0.113.10', port: 22, user: 'deploy', privateKey: null })
    expect(calls[0]!.target.knownHosts).toBeNull()
    expect(status.connection).toMatchObject({
      host: '203.0.113.10',
      user: 'deploy',
      fingerprint: 'SHA256:KeRVA5QsO0lUKYmtzVyHAAcdStXGYGa7lXQ6ai77mEI',
      publicKey,
    })
    expect(status).toMatchObject({ docker: 'ready', dockerVersion: '27.1', pendingKey: null })
    const saved = serverConnection((await accounts.auth('server')).auth.token)
    expect(saved.knownHosts).toBe(`203.0.113.10 ssh-ed25519 ${FIXTURE_KEY}`)
    // Every call after the first checks against the pinned key.
    expect(calls.slice(1).every((call) => call.target.knownHosts === saved.knownHosts)).toBe(true)
  })

  it('refuses a server whose key changed, even when connecting again', async () => {
    const { server, changeKey } = setup()
    await server.createKey()
    await server.connect({ host: '203.0.113.10', port: 22, user: 'deploy', privateKey: null })
    changeKey('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOtherKeyOtherKeyOtherKeyOtherKeyOtherKey00')
    expect((await server.status(true)).error).toMatch(/different server key/)
    const { privateKey } = generateKeyPair()
    await expect(server.connect({ host: '203.0.113.10', port: 22, user: 'deploy', privateKey })).rejects.toThrow(
      /different server key/,
    )
  })

  it('keeps every server connected, so projects stay on theirs while new setups use the latest', async () => {
    const { server, accounts } = setup()
    const { privateKey } = generateKeyPair()
    await server.connect({ host: '203.0.113.10', port: 22, user: 'deploy', privateKey })
    const second = await server.connect({ host: '198.51.100.7', port: 2222, user: 'ops', privateKey })
    const first = 'deploy@203.0.113.10:22'
    expect(second.others).toEqual([{ id: first, name: 'deploy@203.0.113.10' }])
    // A project linked under the first server still reaches it; new setups use the second.
    expect(serverConnection((await accounts.auth('server', first)).auth.token).host).toBe('203.0.113.10')
    expect(serverConnection((await accounts.auth('server')).auth.token).host).toBe('198.51.100.7')
    const switched = await server.use(first)
    expect(serverConnection((await accounts.auth('server')).auth.token).host).toBe('203.0.113.10')
    expect(switched.others).toEqual([{ id: 'ops@198.51.100.7:2222', name: 'ops@198.51.100.7:2222' }])
    await expect(server.forget(first)).rejects.toThrow('new setups use')
    expect((await server.forget('ops@198.51.100.7:2222')).others).toEqual([])
    await accounts.disconnect('server')
    expect(accounts.kept('server')).toEqual([])
  })

  it('needs a key before connecting, and a valid address and user', async () => {
    const { server } = setup()
    await expect(server.connect({ host: '203.0.113.10', port: 22, user: 'deploy', privateKey: null })).rejects.toThrow(
      /Create a key first/,
    )
    await expect(
      server.connect({ host: '-oProxyCommand=x', port: 22, user: 'deploy', privateKey: null }),
    ).rejects.toThrow(/address/)
    await expect(server.connect({ host: 'h.example.com', port: 22, user: '-x', privateKey: null })).rejects.toThrow(
      /user/,
    )
  })
})

it('names every secret the job reads after the app it deploys', () => {
  expect(serverAppName('Ana/My_Shop')).toBe('ana-my-shop')
  expect(Object.values(SERVER_SECRETS).every((name) => name.startsWith('RAMU_SSH_'))).toBe(true)
})
