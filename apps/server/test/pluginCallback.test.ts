import { expect, it } from 'vitest'
import { listenForCallback } from '../src/plugins/callback'

it('ends a plugin sign-in only for its own state, so another page cannot finish or cancel it', async () => {
  const listener = await listenForCallback({ port: 0, timeoutMs: 5_000 })
  try {
    const visit = (query: string) => fetch(`${listener.redirectUri}?${query}`).then((response) => response.status)
    // Before the state is known, and with any other state, a visit is answered and changes nothing.
    expect(await visit('state=s1&code=early')).toBe(400)
    listener.expect('s1')
    expect(await visit('error=access_denied')).toBe(400)
    expect(await visit('state=other&code=c')).toBe(400)
    expect(await visit('state=s1&code=c1')).toBe(200)
    await expect(listener.received).resolves.toEqual({ state: 's1', code: 'c1' })
  } finally {
    listener.stop()
  }
})

it('reports a refusal the service sends back with the sign-in’s state', async () => {
  const listener = await listenForCallback({ port: 0, timeoutMs: 5_000 })
  listener.expect('s2')
  expect((await fetch(`${listener.redirectUri}?state=s2&error=access_denied`)).status).toBe(400)
  await expect(listener.received).rejects.toThrow('access_denied')
})
