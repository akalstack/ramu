import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deployCheckRows, uptimeLines } from '../src/runtime/projectDeploy.ts'

const t = (key, values = {}) => key.replace(/\{(\d+)\}/g, (_, index) => values[index] ?? '')
const time = (at) => `t${at}`

test('the latest deploy is each repository’s default-branch checks, with links', () => {
  const rows = deployCheckRows(
    {
      repositories: [
        {
          repoId: 'r1',
          name: 'shop',
          branch: 'main',
          commit: 'abcdef1234567',
          checks: [
            { name: 'Vercel', state: 'success', url: 'https://vercel.com/me/shop/1' },
            { name: 'CI', state: 'failure', url: null },
          ],
        },
      ],
    },
    t,
  )
  assert.deepEqual(rows, [
    {
      repoId: 'r1',
      title: 'shop · main at abcdef1',
      checks: [
        { key: 'r1:Vercel', name: 'Vercel', state: 'Passed', failed: false, url: 'https://vercel.com/me/shop/1' },
        { key: 'r1:CI', name: 'CI', state: 'Failed', failed: true, url: null },
      ],
    },
  ])
})

test('uptime shows the checked address, the last check and an open incident, or that it is off', () => {
  const watched = uptimeLines(
    {
      enabled: true,
      address: 'https://shop.example.com',
      url: 'https://shop.example.com/api/health',
      last: { at: 9, result: 'down', status: 502, ms: 120, failure: null },
      downSince: 8,
      gap: null,
      incident: { taskId: 'x', openedAt: 9 },
    },
    t,
    time,
  )
  assert.equal(watched.down, true)
  assert.deepEqual(watched.lines, [
    'The host checks https://shop.example.com/api/health every five minutes.',
    'Not answering · HTTP 502 in 120 ms · checked t9',
    'Failing since t8',
    'An incident thread is open in this project since t9.',
  ])
  const unsaved = uptimeLines(
    { enabled: true, address: null, url: null, last: null, downSince: null, gap: null, incident: null },
    t,
    time,
  )
  assert.match(unsaved.lines[0], /save the address/)
  const off = uptimeLines(
    { enabled: false, address: null, url: null, last: null, downSince: null, gap: null, incident: null },
    t,
    time,
  )
  assert.deepEqual(off.lines, ['The live address is not watched.'])
})
