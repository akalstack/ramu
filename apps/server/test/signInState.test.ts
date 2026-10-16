import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { signInState } from '../src/providers/providers'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const cli = (body: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-cli-'))
  dirs.push(dir)
  const bin = join(dir, 'cli')
  writeFileSync(bin, `#!/bin/sh\n${body}\n`)
  chmodSync(bin, 0o755)
  return bin
}

it('reads Codex login status from either output stream', async () => {
  expect(await signInState('codex', cli('echo "Logged in using ChatGPT" >&2'), process.env)).toEqual({
    signedIn: true,
    detail: 'ChatGPT',
  })
  expect(await signInState('codex', cli('echo "Not logged in" >&2; exit 1'), process.env)).toEqual({ signedIn: false })
})
it('reads Claude, Cursor and OpenCode login state', async () => {
  expect(
    await signInState('claude-code', cli('echo \'{"loggedIn":true,"authMethod":"oauth_token"}\''), process.env),
  ).toEqual({ signedIn: true, detail: 'oauth_token' })
  expect(await signInState('claude-code', cli('echo \'{"loggedIn":false}\''), process.env)).toEqual({ signedIn: false })
  // Cursor chats run on its SDK, which takes an API key (or its own stored login), not the CLI's session.
  expect(await signInState('cursor', cli('exit 1'), { ...process.env, CURSOR_API_KEY: 'key' })).toEqual({
    signedIn: true,
    detail: 'API key',
  })
  expect(
    await signInState(
      'opencode',
      cli('echo "Anthropic   API key   stored"; echo "Google  API key  stored"'),
      process.env,
    ),
  ).toEqual({ signedIn: true, detail: '2' })
  expect(await signInState('opencode', cli('echo "No credentials"'), process.env)).toEqual({ signedIn: false })
})
it('reports Antigravity as signed in only when the runtime saved a sign-in method', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ramu-gemini-'))
  dirs.push(home)
  expect(await signInState('antigravity', '', { GEMINI_HOME: home })).toEqual({ signedIn: false })
  mkdirSync(join(home, 'antigravity-acp'))
  writeFileSync(join(home, 'antigravity-acp', 'settings.json'), '{"auth":{"type":"oauth-personal"}}')
  expect(await signInState('antigravity', '', { GEMINI_HOME: home })).toEqual({
    signedIn: true,
    detail: 'oauth-personal',
  })
})
