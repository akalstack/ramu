import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deploymentsView, resourceRows, rollbackConfirmation, storeView } from '../src/runtime/deployments.ts'

const t = (key, values = {}) => key.replace(/\{(\d+)\}/g, (_, index) => values[index] ?? '')
const time = (at) => `t${at}`

const deployment = (patch) => ({
  id: 'd1',
  state: 'ready',
  url: 'shop-1.vercel.app',
  production: true,
  ref: 'main',
  commit: 'abc',
  message: 'Add booking',
  createdAt: 3,
  ...patch,
})

const status = (patch = {}) => ({
  recommended: null,
  binding: {
    platform: 'vercel',
    siteId: 'p',
    siteName: 'shop',
    repository: 'me/shop',
    productionBranch: 'main',
    accountId: 'a',
    scope: null,
  },
  capabilities: ['rollback'],
  productionUrl: 'https://shop.example.com',
  heldForMigrations: false,
  deployments: [
    deployment({ id: 'preview', production: false, ref: 'fix', createdAt: 4 }),
    deployment({ id: 'live', createdAt: 3 }),
    deployment({ id: 'broken', state: 'failed', createdAt: 2 }),
    deployment({ id: 'earlier', createdAt: 1 }),
  ],
  error: null,
  ...patch,
})

test('rows name each deployment, and only an earlier ready production one offers Roll back', () => {
  const view = deploymentsView(status(), null, [], t, time)
  assert.equal(view.target, 'shop · me/shop')
  assert.equal(view.live, 'https://shop.example.com')
  assert.deepEqual(
    view.rows.map((row) => [row.id, row.state, row.detail, row.rollBack]),
    [
      ['preview', 'Ready', 'Preview · fix · t4', false],
      ['live', 'Ready', 'Production · main · t3', false],
      ['broken', 'Failed', 'Production · main · t2', false],
      ['earlier', 'Ready', 'Production · main · t1', true],
    ],
  )
  assert.equal(view.rows[2].failed, true)
})

test('a platform that cannot roll back offers it nowhere', () => {
  const view = deploymentsView(status({ capabilities: [] }), null, [], t, time)
  assert.equal(
    view.rows.some((row) => row.rollBack),
    false,
  )
})

test('uptime shows the checked address, the last check and an open incident, or that it is off', () => {
  const watched = deploymentsView(
    status(),
    {
      enabled: true,
      url: 'https://shop.example.com/api/health',
      last: { at: 9, result: 'down', status: 502, ms: 120, failure: null },
      downSince: 8,
      gap: null,
      incident: { taskId: 'x', openedAt: 9 },
    },
    [],
    t,
    time,
  )
  assert.equal(watched.uptime.down, true)
  assert.deepEqual(watched.uptime.lines, [
    'The host checks https://shop.example.com/api/health every five minutes.',
    'Not answering · HTTP 502 in 120 ms · checked t9',
    'Failing since t8',
    'An incident thread is open in this project since t9.',
  ])
  const off = deploymentsView(
    status(),
    { enabled: false, url: null, last: null, downSince: null, gap: null, incident: null },
    [],
    t,
    time,
  )
  assert.equal(off.uptime.lines.length, 1)
  assert.match(off.uptime.lines[0], /not watched/)
})

test('usage marks a figure at 80% of its limit and says when the platform reports no limits', () => {
  const view = deploymentsView(
    status(),
    null,
    [
      {
        platform: 'netlify',
        name: 'Netlify',
        period: null,
        figures: [{ metric: 'build-minutes', service: null, used: 250, unit: 'minutes', limit: 300 }],
        unavailable: null,
        billingPage: 'https://app.netlify.com/billing',
      },
      {
        platform: 'vercel',
        name: 'Vercel',
        period: null,
        figures: [{ metric: 'service', service: 'Fast Data Transfer', used: 2, unit: 'GB', limit: null }],
        unavailable: null,
        billingPage: 'https://vercel.com/billing',
      },
    ],
    t,
    time,
  )
  assert.equal(view.usage[0].lines[0].warn, true)
  assert.match(view.usage[0].lines[0].text, /^Build minutes: 250 minutes of 300 minutes \(83%\)$/)
  assert.equal(view.usage[1].lines.length, 2)
  assert.match(view.usage[1].lines[1].text, /reports no plan limits/)
})

test('the rollback confirmation names the version and the address that changes', () => {
  const current = status()
  const { title, message } = rollbackConfirmation(current, current.deployments[3], t, time)
  assert.equal(title, 'Roll back')
  assert.equal(
    message,
    'Production · main · t1\nAdd booking\n\nhttps://shop.example.com will show this version until the next deploy.',
  )
})

test('lists custom domains with where each is, and only a live one opens', () => {
  const view = deploymentsView(status(), null, [], t, time, [
    { name: 'shop.com', records: [], configured: true, certificate: true, managedDns: false },
    { name: 'www.shop.com', records: [], configured: true, certificate: false, managedDns: false },
    { name: 'new.shop.com', records: [], configured: false, certificate: false, managedDns: true },
  ])
  assert.deepEqual(view.domains, [
    { name: 'shop.com', state: 'Live over HTTPS', live: true },
    { name: 'www.shop.com', state: 'Waiting for the HTTPS certificate', live: false },
    { name: 'new.shop.com', state: 'Waiting for DNS', live: false },
  ])
  assert.deepEqual(deploymentsView(status(), null, [], t, time).domains, [])
})

test('shows store builds with their upload, and says why Release cannot start yet', () => {
  const build = {
    id: 'b1',
    platform: 'android',
    state: 'ready',
    profile: 'production',
    version: '1.2.0',
    buildNumber: '7',
    commit: 'abc',
    message: 'Add booking',
    error: null,
    createdAt: 5,
    page: 'https://expo.dev/b1',
    submission: { id: 's1', state: 'failed', track: null, error: 'No service account' },
  }
  const release = {
    app: { name: 'Shop', projectId: 'p', page: null },
    connected: true,
    account: 'me',
    checks: [{ id: 'android-package', state: 'ok', detail: 'com.shop' }],
    builds: [build],
    error: null,
  }
  const view = storeView(release, t, time)
  assert.equal(view.canRelease, true)
  assert.equal(view.blocked, null)
  assert.deepEqual(view.builds[0], {
    id: 'b1',
    state: 'Ready',
    failed: false,
    detail: 'Android · 1.2.0 (7) · t5',
    message: 'Add booking',
    error: null,
    upload: { text: 'Upload to Play’s internal track: Failed · No service account', failed: true },
    page: 'https://expo.dev/b1',
  })
  assert.equal(storeView({ ...release, connected: false }, t, time).canRelease, false)
  assert.match(storeView({ ...release, app: { ...release.app, projectId: null } }, t, time).blocked, /Deploy sheet/)
  assert.equal(storeView({ ...release, app: null }, t, time), null)
})

test('lists a project’s databases with their provider, variables and preview branch', () => {
  const rows = resourceRows(
    {
      needsDatabase: true,
      providers: [{ provider: 'neon', name: 'Neon', kind: 'database', connected: true, plans: [] }],
      resources: [
        {
          provider: 'neon',
          kind: 'database',
          id: 'n1',
          name: 'shop',
          variables: ['DATABASE_URL', 'DATABASE_URL_UNPOOLED'],
          previewBranch: true,
          page: 'https://console.neon.tech/app/projects/n1',
        },
      ],
      migrate: null,
    },
    t,
  )
  assert.deepEqual(rows, [
    {
      id: 'neon:n1',
      name: 'shop',
      detail: 'Neon · DATABASE_URL, DATABASE_URL_UNPOOLED · previews use their own database',
      page: 'https://console.neon.tech/app/projects/n1',
    },
  ])
  assert.deepEqual(resourceRows(null, t), [])
})
