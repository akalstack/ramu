import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RemoteServers, type Sealer } from '../src/main/remoteServers'

const dirs: string[] = []
afterEach(() => {
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dirs.length = 0
})
const reversible: Sealer = {
  available: true,
  seal: (text) => Buffer.from(text).reverse().toString('base64'),
  open: (text) => Buffer.from(text, 'base64').reverse().toString(),
}
const none: Sealer = {
  available: false,
  seal: () => {
    throw new Error('no keychain')
  },
  open: () => {
    throw new Error('no keychain')
  },
}
const store = (sealer = reversible) => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu servers '))
  dirs.push(dir)
  const path = join(dir, 'remote-servers.json')
  return { path, servers: new RemoteServers(path, sealer) }
}

it('saves a host and hands its token only to the main process', () => {
  const { servers } = store()
  const saved = servers.add('100.64.0.7:7788', ' Studio ', 'secret-token')
  expect(saved).toMatchObject({ name: 'Studio', url: 'http://100.64.0.7:7788' })
  expect(JSON.stringify(servers.list())).not.toContain('secret-token')
  expect(servers.endpoint(saved.id)).toEqual({ kind: 'http', url: 'http://100.64.0.7:7788', token: 'secret-token' })
  expect(servers.endpoint('missing')).toBeNull()
})

it('encrypts the token on disk and keeps the file private', () => {
  const { path, servers } = store()
  servers.add('https://studio.example.net', undefined, 'secret-token')
  expect(readFileSync(path, 'utf8')).not.toContain('secret-token')
  expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(servers.list()[0]!.name).toBe('studio.example.net')
})

it('still works when the system has no keychain, using the private file', () => {
  const { servers } = store(none)
  const { id } = servers.add('192.168.1.5:7788', 'Home', 'plain-token')
  expect(servers.endpoint(id)?.token).toBe('plain-token')
})

it('replaces a host paired again at the same address, and keeps several others', () => {
  const { servers } = store()
  servers.add('192.168.1.5:7788', 'Old', 'one')
  servers.add('10.0.0.2:7788', 'Other', 'three')
  servers.add('http://192.168.1.5:7788/', 'New', 'two')
  expect(
    servers
      .list()
      .map((s) => s.name)
      .sort(),
  ).toEqual(['New', 'Other'])
})

it('forgets one host without touching the rest', () => {
  const { servers } = store()
  const a = servers.add('10.0.0.2:7788', 'A', 'a'),
    b = servers.add('10.0.0.3:7788', 'B', 'b')
  servers.forget(a.id)
  expect(servers.list().map((s) => s.id)).toEqual([b.id])
})

it('persists names and connection policy without changing identity or credentials', () => {
  const { path, servers } = store()
  const saved = servers.add('10.0.0.2:7788', 'Studio', 'private-token')
  const before = servers.endpoint(saved.id)
  const updated = servers.update(saved.id, { name: ' Workstation ', enabled: false, retryMode: 'periodic' })
  expect(updated).toMatchObject({ id: saved.id, name: 'Workstation', enabled: false, retryMode: 'periodic' })
  expect(servers.endpoint(saved.id)).toEqual(before)
  const reopened = new RemoteServers(path, reversible)
  expect(reopened.list()).toEqual([updated])
  expect(readFileSync(path, 'utf8')).not.toContain('private-token')
  expect(() => servers.update(saved.id, { name: ' ' })).toThrow('name')
})

it('decrypts a saved endpoint once and preserves the cache across metadata changes', () => {
  let decrypts = 0
  const { servers } = store({
    ...reversible,
    open: (value) => {
      decrypts++
      return reversible.open(value)
    },
  })
  const saved = servers.add('10.0.0.2:7788', 'Studio', 'secret')
  for (let i = 0; i < 100; i++) expect(servers.endpoint(saved.id)?.token).toBe('secret')
  expect(decrypts).toBe(1)
  servers.update(saved.id, { name: 'Workstation' })
  expect(servers.endpoint(saved.id)?.token).toBe('secret')
  expect(decrypts).toBe(1)
})

it('ignores the old single-active format, rejects bad addresses and survives a corrupt file', () => {
  const { path, servers } = store()
  expect(() => servers.add('ftp://host', 'x', 't')).toThrow()
  const { id } = servers.add('10.0.0.2:7788', 'A', 'a')
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  writeFileSync(path, JSON.stringify({ ...saved, active: id }))
  expect(servers.list()).toHaveLength(1)
  writeFileSync(path, '{nope')
  expect(servers.list()).toEqual([])
})
