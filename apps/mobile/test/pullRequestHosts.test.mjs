import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pullRequestHostChoices } from '../src/runtime/pullRequestHosts.ts'

const pr = (url) => ({ url, number: 1, title: 't', state: 'open', draft: false, updatedAt: 1 })
const repo = (url, outside = false) => ({
  projectId: 'p',
  projectName: 'app',
  repoId: outside ? 'outside:o/app' : 'r',
  repoName: 'app',
  pullRequests: [pr(url)],
  local: {},
  ...(outside ? { outside: true } : {}),
})

test('a pull request can move to another connected host whose checkout lists it, never to an outside listing', () => {
  const url = 'https://x/pull/1'
  const choices = pullRequestHostChoices(
    [
      { host: 'a', repositories: [repo(url)] },
      { host: 'a', repositories: [repo(url)] },
      { host: 'b', repositories: [repo(url)] },
      { host: 'c', repositories: [repo(url)] },
      { host: 'd', repositories: [repo(url, true)] },
      { host: 'e', repositories: [repo('https://x/pull/2')] },
    ],
    url,
    'a',
    (host) => host !== 'c',
  )
  assert.deepEqual(
    choices.map((row) => row.host),
    ['a', 'b'],
  )
})
