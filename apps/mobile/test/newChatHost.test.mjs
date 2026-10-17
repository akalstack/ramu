import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newChatHost } from '../src/runtime/newChatHost.ts'
const computers = [
  { id: 'a', status: 'online' },
  { id: 'b', status: 'offline' },
  { id: 'c', status: 'revoked' },
]
const projects = [
  { id: 'a:p', computerId: 'a' },
  { id: 'b:p', computerId: 'b' },
]
const resolve = (host, project = 'no-project') => newChatHost(host, project, computers, projects, 'no-project')

test('a draft stays bound to its explicit host, including offline standalone drafts', () => {
  assert.equal(resolve('b'), 'b')
  assert.equal(resolve('b', 'b:p'), 'b')
  assert.equal(resolve('a', 'a:p'), 'a')
})
test('a removed or revoked host never falls back to another paired host', () => {
  assert.throws(() => resolve('gone'), /Pair a host/)
  assert.throws(() => resolve('c'), /Pair a host/)
})
test('a project belonging to another host cannot be submitted', () => {
  assert.throws(() => resolve('b', 'a:p'), /project on this host/)
  assert.throws(() => resolve('b', 'deleted'), /project on this host/)
})
