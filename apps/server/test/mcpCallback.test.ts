import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { deliverLoopbackCallback, loopbackRedirect } from '../src/agent/mcpCallback'

const servers: ReturnType<typeof createServer>[] = []
afterEach(() => servers.splice(0).forEach((server) => server.close()))

/** A provider's sign-in listener on this host, recording what reached it. */
async function listener(status = 200) {
  const seen: string[] = []
  const server = createServer((request, response) => {
    seen.push(request.url ?? '')
    response.writeHead(status, status === 302 ? { location: 'https://example.com/' } : {}).end('done')
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return { seen, redirect: `http://127.0.0.1:${port}/callback` }
}
const authorize = (redirect: string) =>
  `https://mcp.example.com/authorize?state=s1&redirect_uri=${encodeURIComponent(redirect)}`

it('a sign-in returning to the host takes the address pasted from another device to its listener', async () => {
  const { seen, redirect } = await listener()
  const expected = loopbackRedirect(authorize(redirect))!
  await deliverLoopbackCallback(expected, ` ${redirect}?code=c1&state=s1 `)
  expect(seen).toEqual(['/callback?code=c1&state=s1'])
})

it('only the loopback address the sign-in named is ever requested', async () => {
  const { seen, redirect } = await listener()
  const expected = loopbackRedirect(authorize(redirect))!
  const other = redirect.replace(/:\d+\//, ':1/')
  await expect(deliverLoopbackCallback(expected, `${other}?code=c1`)).rejects.toThrow('different sign-in')
  await expect(deliverLoopbackCallback(expected, 'https://evil.example/callback?code=c1')).rejects.toThrow(
    'different sign-in',
  )
  await expect(deliverLoopbackCallback(expected, redirect)).rejects.toThrow('no sign-in code')
  await expect(deliverLoopbackCallback(expected, 'not an address')).rejects.toThrow('whole address')
  expect(seen).toEqual([])
  // A page that returns anywhere but this host is not offered the paste at all.
  expect(loopbackRedirect(authorize('https://app.example.com/callback'))).toBeUndefined()
  expect(loopbackRedirect('https://mcp.example.com/authorize')).toBeUndefined()
})

it('a listener that refuses the code, or has stopped waiting, says so', async () => {
  const refused = await listener(400)
  await expect(
    deliverLoopbackCallback(loopbackRedirect(authorize(refused.redirect))!, `${refused.redirect}?code=c1`),
  ).rejects.toThrow('did not accept')
  // A redirect from the listener is not followed.
  const moved = await listener(302)
  await deliverLoopbackCallback(loopbackRedirect(authorize(moved.redirect))!, `${moved.redirect}?code=c1`)
  expect(moved.seen).toHaveLength(1)
  const gone = await listener()
  servers.pop()!.close()
  await new Promise((resolve) => setTimeout(resolve, 20))
  await expect(
    deliverLoopbackCallback(loopbackRedirect(authorize(gone.redirect))!, `${gone.redirect}?code=c1`),
  ).rejects.toThrow('no longer waiting')
})
