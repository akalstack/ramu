import { test } from 'node:test'
import assert from 'node:assert/strict'
import { childPath, repositoryCloneUrl } from '../src/runtime/cloneRepository.ts'

test('a clone lands beside the folder in view, with the separator the host writes', () => {
  assert.equal(childPath('/Users/me/code', 'ramu'), '/Users/me/code/ramu')
  assert.equal(childPath('/', 'ramu'), '/ramu')
  assert.equal(childPath('C:\\Users\\me', 'ramu'), 'C:\\Users\\me\\ramu')
})

test("a pull request's repository clones from the address the host's account lists, else its service's", () => {
  const found = [{ fullName: 'Acme/Web', cloneUrl: 'https://github.com/Acme/Web.git' }]
  assert.equal(repositoryCloneUrl('acme/web', found), 'https://github.com/Acme/Web.git')
  assert.equal(repositoryCloneUrl('acme/api', found, 'git.acme.dev'), 'https://git.acme.dev/acme/api.git')
  assert.equal(repositoryCloneUrl('acme/api', [], 'evil.dev/x?'), 'https://github.com/acme/api.git')
})
