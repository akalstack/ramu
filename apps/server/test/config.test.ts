import { expect, it } from 'vitest'
import { defaultUserData, loadConfig, parseListen } from '../src/config'

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
  expect(loadConfig({ ...base, RAMU_LISTEN: '0.0.0.0:7788', RAMU_ALLOW_PLAINTEXT_REMOTE: '1' }).listen?.host).toBe(
    '0.0.0.0',
  )
  expect(loadConfig(base).listen).toBeNull()
})

it('serves a network listener over TLS without the plaintext opt-in, and needs both files', () => {
  const base = { RAMU_USER_DATA: '/tmp/ramu-profile', RAMU_LISTEN: '0.0.0.0:7788' }
  const config = loadConfig({ ...base, RAMU_TLS_CERT: '/c.pem', RAMU_TLS_KEY: '/k.pem' })
  expect(config.tls).toEqual({ cert: '/c.pem', key: '/k.pem' })
  expect(config.listen?.host).toBe('0.0.0.0')
  expect(() => loadConfig({ ...base, RAMU_TLS_CERT: '/c.pem' })).toThrow(/both/)
  expect(() => loadConfig({ ...base, RAMU_LISTEN: '7788', RAMU_TLS_KEY: '/k.pem' })).toThrow(/both/)
  expect(loadConfig({ RAMU_USER_DATA: '/tmp/p' }).devicesPath).toBe('/tmp/p/remote-devices.json')
})

it('uses the desktop profile directory by default', () => {
  expect(defaultUserData('darwin', {})).toMatch(/Library\/Application Support\/Ramu$/)
  expect(defaultUserData('linux', { XDG_CONFIG_HOME: '/x' })).toBe('/x/Ramu')
})

it('requires explicit browser access, and validates credential lifetimes', () => {
  const base = { RAMU_USER_DATA: '/tmp/ramu-profile' }
  expect(loadConfig(base)).toMatchObject({
    browserOrigins: [],
    deviceLifetimeMs: 90 * 86400000,
  })
  expect(loadConfig({ ...base, RAMU_DEVICE_TOKEN_DAYS: 'never' }).deviceLifetimeMs).toBeNull()
  expect(loadConfig({ ...base, RAMU_BROWSER_ORIGINS: 'https://app.example' })).toMatchObject({
    browserOrigins: ['https://app.example'],
  })
  for (const days of ['0', '-1', 'garbage', 'Infinity'])
    expect(() => loadConfig({ ...base, RAMU_DEVICE_TOKEN_DAYS: days })).toThrow()
  for (const origin of ['*', 'null', 'https://app.example/path', 'file:///tmp'])
    expect(() => loadConfig({ ...base, RAMU_BROWSER_ORIGINS: origin })).toThrow()
})
