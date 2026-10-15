import { afterEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { explainSshFailure, listSshHosts, parseRemoteReport, parseSshConfigHosts, remoteForward, tunnelArgs, SshComputers } from '../src/main/sshComputers'
import { RemoteServers } from '../src/main/remoteServers'

const dirs: string[] = []
afterEach(() => { dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })); dirs.length = 0 })

it('lists concrete aliases from ssh config and skips patterns', () => {
  expect(parseSshConfigHosts('Host build staging # note\n  HostName x\nHost *\nHost !bad *.corp\nhost prod')).toEqual(['build', 'staging', 'prod'])
  const home = mkdtempSync(join(tmpdir(), 'ramu-ssh ')); dirs.push(home)
  mkdirSync(join(home, '.ssh'))
  writeFileSync(join(home, '.ssh', 'config'), 'Include extra\nHost zed\n')
  writeFileSync(join(home, '.ssh', 'extra'), 'Host alpha\n')
  expect(listSshHosts(home)).toEqual(['alpha', 'zed'])
  expect(listSshHosts(join(home, 'nowhere'))).toEqual([])
})

it('reads the last JSON line and builds the forward address', () => {
  expect(parseRemoteReport('Welcome!\n{"state":"ready","listening":"0.0.0.0:7788"}\n')).toMatchObject({ state: 'ready', listening: '0.0.0.0:7788' })
  expect(() => parseRemoteReport('banner only')).toThrow()
  expect(remoteForward('0.0.0.0:7788')).toBe('127.0.0.1:7788')
  expect(remoteForward('100.64.0.7:9000')).toBe('100.64.0.7:9000')
  expect(remoteForward('[::1]:7788')).toBe('[::1]:7788')
  expect(() => remoteForward('nope')).toThrow()
})

it('never lets a target act as an ssh option', () => {
  const args = tunnelArgs('build', 49200, '127.0.0.1:7788')
  expect(args.slice(-2)).toEqual(['--', 'build'])
  expect(args).toContain('127.0.0.1:49200:127.0.0.1:7788')
  expect(args).toContain('BatchMode=yes')
})

it('turns ssh errors into next steps', () => {
  expect(explainSshFailure('build', 'Host key verification failed.')).toMatch(/ssh build/)
  expect(explainSshFailure('build', 'build: Permission denied (publickey).')).toMatch(/key-based/)
  expect(explainSshFailure('nope', 'ssh: Could not resolve hostname nope')).toMatch(/Cannot find nope/)
})

function ssh(reply: { stdout: string; stderr?: string; code?: number }) {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-ssh ')); dirs.push(dir)
  const servers = new RemoteServers(join(dir, 's.json'), { available: false, seal: (t) => t, open: (t) => t })
  const calls: string[][] = []
  const tunnels = new SshComputers(servers, async (args) => { calls.push(args); return { stdout: reply.stdout, stderr: reply.stderr ?? '', code: reply.code ?? 0 } })
  return { tunnels, calls }
}

it('asks the other computer to start ramu and reports why it cannot', async () => {
  const ok = ssh({ stdout: '{"state":"ready","listening":"127.0.0.1:7788","code":"K7QM2-X9RTD","urls":["http://127.0.0.1:7788"]}' })
  expect((await ok.tunnels.provision('build', 'pair')).code).toBe('K7QM2-X9RTD')
  expect(ok.calls[0]).toEqual(expect.arrayContaining(['--', 'build', 'sh', '-l', '-s', 'pair']))
  await expect(ssh({ stdout: '{"state":"missing"}' }).tunnels.provision('build', 'pair')).rejects.toThrow(/not installed on build/)
  await expect(ssh({ stdout: '{"state":"not-listening"}' }).tunnels.provision('build', 'ensure')).rejects.toThrow(/without network access/)
  await expect(ssh({ stdout: '{"state":"ready","listening":"127.0.0.1:7788","code":"A","urls":["https://x:7788"]}' }).tunnels.provision('build', 'pair')).rejects.toThrow(/HTTPS/)
  await expect(ssh({ stdout: '', stderr: 'Host key verification failed.', code: 255 }).tunnels.provision('build', 'pair')).rejects.toThrow(/not a trusted host/)
  await expect(ssh({ stdout: '' }).tunnels.provision('-oProxyCommand=x', 'pair')).rejects.toThrow(/user@host/)
})
