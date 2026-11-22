import { expect, it } from 'vitest'
import { LINK_LIMITS, linkHostname, linkUsageLevel, recommendRoutes, type RouteInput } from '../src/ramuLink'

const none = { cloudflared: false, tailscale: false, ngrok: false }
const kinds = (input: RouteInput) => recommendRoutes(input).map((option) => option.kind)

it('leads with Ramu Link while a slot is free or the host holds one', () => {
  const open = { capacity: 950, used: 10, waiting: 0 }
  expect(kinds({ link: null, pool: open, signedIn: false, tools: none })).toEqual([
    'link',
    'own-relay',
    'install-tailscale',
  ])
  const full = { capacity: 950, used: 950, waiting: 4 }
  expect(kinds({ link: { state: 'active' }, pool: full, signedIn: true, tools: none })[0]).toBe('link')
  expect(recommendRoutes({ link: null, pool: open, signedIn: true, tools: none })[0]?.recommended).toBe(true)
})

it('turns to what the host has when the pool is full, keeping the waitlist last', () => {
  const full = { capacity: 950, used: 950, waiting: 4 }
  expect(
    kinds({ link: null, pool: full, signedIn: true, tools: { ...none, tailscale: true, cloudflared: true } }),
  ).toEqual(['tailscale', 'own-relay', 'quick', 'link'])
  expect(
    kinds({ link: { state: 'waitlisted' }, pool: null, signedIn: true, tools: { ...none, cloudflared: true } }),
  ).toEqual(['own-relay', 'quick', 'install-tailscale', 'link'])
})

it('suggests installing Tailscale first when nothing is installed and the link cannot be had', () => {
  for (const state of ['waitlisted', 'suspended', 'taken', 'unavailable'] as const)
    expect(kinds({ link: { state }, pool: null, signedIn: true, tools: none })).toEqual([
      'install-tailscale',
      'own-relay',
      'link',
    ])
})

it('names hosts with one label and grades monthly traffic', () => {
  expect(linkHostname('3f9c2a')).toBe('ramu-3f9c2a.akalstack.com')
  expect(linkUsageLevel(0)).toBe('ok')
  expect(linkUsageLevel(LINK_LIMITS.monthlyBytes * 0.8)).toBe('warn')
  expect(linkUsageLevel(LINK_LIMITS.monthlyBytes)).toBe('over')
})
