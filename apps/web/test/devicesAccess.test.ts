import { describe, expect, it } from 'vitest'
import { accountAccess, accountSwitches, type AccountAccess } from '../src/settings/access/accountTrust'
import { chooseReach, reachOf, REACHES, type ListenDraft, type TunnelDraft } from '../src/settings/access/reach'

const listen = (change: Partial<ListenDraft> = {}): ListenDraft => ({
  enabled: false,
  host: '0.0.0.0',
  port: '7788',
  discoverable: false,
  ...change,
})
const tunnel = (change: Partial<TunnelDraft> = {}): TunnelDraft => ({
  mode: 'off',
  domain: '',
  relay: '',
  url: '',
  ...change,
})

describe('Reachable from, read from the saved listener and tunnel', () => {
  it('is This computer while nothing listens beyond it', () => {
    expect(reachOf(listen(), tunnel())).toBe('computer')
    expect(reachOf(listen({ enabled: true, host: '127.0.0.1' }), tunnel())).toBe('computer')
    // A tunnel address the person runs does nothing until the listener is on.
    expect(reachOf(listen(), tunnel({ mode: 'manual', url: 'https://ramu.example.com' }))).toBe('computer')
  })

  it('is This network while the listener is open on every network or a chosen one', () => {
    expect(reachOf(listen({ enabled: true }), tunnel())).toBe('network')
    expect(reachOf(listen({ enabled: true, host: '100.64.0.7' }), tunnel())).toBe('network')
  })

  it('is Anywhere with any tunnel, even one that opened the listener for this computer only', () => {
    expect(reachOf(listen({ enabled: true }), tunnel({ mode: 'link' }))).toBe('anywhere')
    expect(reachOf(listen({ enabled: true, host: '127.0.0.1' }), tunnel({ mode: 'tailscale' }))).toBe('anywhere')
    expect(reachOf(listen(), tunnel({ mode: 'quick' }))).toBe('anywhere')
    expect(reachOf(listen({ enabled: true }), tunnel({ mode: 'manual', url: 'https://ramu.example.com' }))).toBe(
      'anywhere',
    )
  })
})

describe('choosing where this host is reachable from', () => {
  it('reads back as the choice made, from any starting point', () => {
    const starts = [
      [listen(), tunnel()],
      [listen({ enabled: true, host: '127.0.0.1' }), tunnel({ mode: 'ngrok', domain: 'me.ngrok-free.app' })],
      [listen({ enabled: true, host: '100.64.0.7' }), tunnel()],
    ] as const
    for (const [from, via] of starts)
      for (const reach of REACHES) {
        const chosen = chooseReach(reach, from, via, true)
        expect(reachOf(chosen.listen, chosen.tunnel)).toBe(reach)
      }
  })

  it('opens every network for This network unless a network was already picked, and stops any tunnel', () => {
    const fromLoopback = chooseReach('network', listen({ host: '127.0.0.1' }), tunnel({ mode: 'link' }), true)
    expect(fromLoopback.listen).toMatchObject({ enabled: true, host: '0.0.0.0' })
    expect(fromLoopback.tunnel.mode).toBe('off')
    expect(chooseReach('network', listen({ host: '100.64.0.7' }), tunnel(), true).listen.host).toBe('100.64.0.7')
  })

  it('adds Ramu Link for Anywhere, keeps a tunnel already chosen, and asks for an address on a host without tunnels', () => {
    expect(chooseReach('anywhere', listen(), tunnel(), true).tunnel.mode).toBe('link')
    expect(chooseReach('anywhere', listen(), tunnel(), false).tunnel.mode).toBe('manual')
    const ngrok = tunnel({ mode: 'ngrok', domain: 'me.ngrok-free.app' })
    expect(chooseReach('anywhere', listen({ enabled: true }), ngrok, true).tunnel).toEqual(ngrok)
  })

  it('closes the listener and the tunnel for This computer, keeping the port and discoverability', () => {
    const chosen = chooseReach(
      'computer',
      listen({ enabled: true, port: '7790', discoverable: true }),
      tunnel({ mode: 'link' }),
      true,
    )
    expect(chosen.listen).toEqual(listen({ enabled: false, port: '7790', discoverable: true }))
    expect(chosen.tunnel.mode).toBe('off')
  })
})

describe('devices on the Ramu account as two switches', () => {
  it('maps each saved choice to the switches and back', () => {
    const cases: [AccountAccess, ReturnType<typeof accountSwitches>][] = [
      ['off', { connect: false, ask: false, viewOnly: false }],
      ['owner', { connect: true, ask: false, viewOnly: false }],
      ['ask', { connect: true, ask: true, viewOnly: false }],
      ['viewer', { connect: true, ask: false, viewOnly: true }],
    ]
    for (const [access, switches] of cases) {
      expect(accountSwitches(access)).toEqual(switches)
      expect(accountAccess(switches)).toBe(access)
    }
  })

  it('lets asking first win over view-only, and turning off win over both', () => {
    expect(accountAccess({ connect: true, ask: true, viewOnly: true })).toBe('ask')
    expect(accountAccess({ connect: false, ask: true, viewOnly: true })).toBe('off')
  })
})
