import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  connectedRoute,
  nextStep,
  previousStep,
  reachPlan,
  resumeStep,
  resumesOnboarding,
} from '../src/runtime/onboardingModel.ts'

const none = { cloudflared: false, tailscale: false, ngrok: false }

test('a reopened app resumes its step, moved to Connect without a host and to Connected with one', () => {
  assert.equal(resumeStep(undefined, 0), 'welcome')
  assert.equal(resumeStep('connect', 0), 'connect')
  assert.equal(resumeStep('notifications', 0), 'connect')
  assert.equal(resumeStep('welcome', 1), 'connected')
  assert.equal(resumeStep('notifications', 1), 'notifications')
  assert.equal(resumeStep('nonsense', 0), 'welcome')
  assert.equal(resumesOnboarding('notifications', 1), true)
  assert.equal(resumesOnboarding('connect', 1), false)
  assert.equal(resumesOnboarding('done', 1), false)
  assert.equal(resumesOnboarding('notifications', 0), false)
})

test('steps go forward in order, and back never returns to pairing once paired', () => {
  assert.equal(nextStep('welcome'), 'connect')
  assert.equal(nextStep('notifications'), 'done')
  assert.equal(nextStep('done'), null)
  assert.equal(previousStep('connect'), 'welcome')
  assert.equal(previousStep('connected'), null)
  assert.equal(previousStep('notifications'), 'connected')
  assert.equal(previousStep('welcome'), null)
})

test('names how the phone reaches the host, Ramu Link by its address', () => {
  assert.equal(connectedRoute('https://ramu-3f9c2a.akalstack.com'), 'link')
  assert.equal(connectedRoute('http://192.168.1.4:7788'), 'LAN')
  assert.equal(connectedRoute('http://100.101.1.2:7788'), 'VPN')
})

test('offers Ramu Link while a slot is free, and the best other route when it is full', () => {
  const lan = 'http://192.168.1.4:7788'
  assert.deepEqual(reachPlan('https://ramu-1.akalstack.com', null, true), { kind: 'reachable' })
  assert.deepEqual(reachPlan(lan, null, true), { kind: 'on-computer' })
  const open = { capacity: 950, used: 3, waiting: 0 }
  assert.deepEqual(reachPlan(lan, { pool: open, tools: none }, false), { kind: 'offer-link' })
  assert.deepEqual(reachPlan(lan, { link: { state: 'active', hostname: 'ramu-1.akalstack.com' }, tools: none }, true), {
    kind: 'link-active',
    hostname: 'ramu-1.akalstack.com',
  })
  const full = { capacity: 950, used: 950, waiting: 2 }
  assert.deepEqual(reachPlan(lan, { pool: full, tools: { ...none, tailscale: true } }, true), {
    kind: 'full',
    alternative: 'tailscale',
  })
  assert.deepEqual(reachPlan(lan, { link: { state: 'waitlisted', hostname: null }, tools: none }, true), {
    kind: 'full',
    alternative: 'install-tailscale',
  })
  assert.deepEqual(
    reachPlan(lan, { link: { state: 'suspended', hostname: null }, tools: { ...none, cloudflared: true } }, true),
    {
      kind: 'blocked',
      reason: 'suspended',
      alternative: 'own-relay',
    },
  )
})
