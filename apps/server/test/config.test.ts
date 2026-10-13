import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authorized, loadToken, TokenStore } from '../src/auth'
import { defaultUserData, loadConfig, parseListen } from '../src/config'

const dirs: string[] = []
afterEach(() => { dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })); dirs.length = 0 })
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), 'ramu server ')); dirs.push(dir); return dir }

it('parses listen addresses and binds loopback by default', () => {
  expect(parseListen('7788')).toEqual({ host: '127.0.0.1', port: 7788 })
  expect(parseListen(':7788')).toEqual({ host: '127.0.0.1', port: 7788 })
  expect(parseListen('0.0.0.0:80')).toEqual({ host: '0.0.0.0', port: 80 })
  expect(parseListen('[::1]:9000')).toEqual({ host: '::1', port: 9000 })
  for (const bad of ['', 'abc', '70000', '0', 'host:']) expect(() => parseListen(bad)).toThrow()
})

it('refuses plaintext network listeners unless explicitly allowed', () => {
  const base = { RAMU_USER_DATA: '/tmp/ramu-profile' }
  expect(loadConfig({ ...base, RAMU_LISTEN: '7788' }).listen).toEqual({ host: '127.0.0.1', port: 7788 })
  expect(() => loadConfig({ ...base, RAMU_LISTEN: '0.0.0.0:7788' })).toThrow(/not encrypted/)
  expect(loadConfig({ ...base, RAMU_LISTEN: '0.0.0.0:7788', RAMU_ALLOW_PLAINTEXT_REMOTE: '1' }).listen?.host).toBe('0.0.0.0')
  expect(loadConfig(base).listen).toBeNull()
})

it('uses the desktop profile directory by default', () => {
  expect(defaultUserData('darwin', {})).toMatch(/Library\/Application Support\/Ramu$/)
  expect(defaultUserData('linux', { XDG_CONFIG_HOME: '/x' })).toBe('/x/Ramu')
})

it('creates a private token, accepts only that token, and revokes on rotation', () => {
  const path = join(tmp(), 'remote-token')
  const token = loadToken(path)
  expect(token).toMatch(/^[a-f0-9]{64}$/)
  expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(loadToken(path)).toBe(token)
  expect(authorized(`Bearer ${token}`, token)).toBe(true)
  expect(authorized(`Bearer ${'0'.repeat(64)}`, token)).toBe(false)
  expect(authorized(undefined, token)).toBe(false)
  expect(authorized(token, token)).toBe(false)
  const store = new TokenStore(path)
  expect(store.current()).toBe(token)
  const rotated = loadToken(path, true)
  expect(rotated).not.toBe(token)
  expect(store.current()).toBe(rotated)
})

it('replaces a malformed token file', () => {
  const path = join(tmp(), 'remote-token')
  writeFileSync(path, 'not-a-token')
  expect(loadToken(path)).toMatch(/^[a-f0-9]{64}$/)
})
