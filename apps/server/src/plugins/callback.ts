// The loopback callback a plugin's sign-in returns to: listening on this computer only while one sign-in is open, so
// the service redirects the person's browser back to Ramu with the code, which never passes through a plugin.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PLUGIN_CALLBACK_PORT } from '@ramu/shared/plugins'

export interface CallbackListener {
  redirectUri: string
  /** Resolves with the state and code the browser came back with. */
  received: Promise<{ state: string; code: string }>
  stop(): void
}

export function listenForCallback(
  options: { port?: number; timeoutMs?: number; service?: string } = {},
): Promise<CallbackListener> {
  const port = options.port ?? PLUGIN_CALLBACK_PORT
  let redirectUri = `http://localhost:${port}/plugin/callback`
  return new Promise((ready, refuse) => {
    let finish: (value: { state: string; code: string }) => void = () => {}
    let fail: (error: Error) => void = () => {}
    const received = new Promise<{ state: string; code: string }>((resolve, reject) => {
      finish = resolve
      fail = reject
    })
    void received.catch(() => {})
    const server: Server = createServer((req, res) => {
      const at = new URL(req.url ?? '/', redirectUri)
      if (at.pathname !== '/plugin/callback') return void res.writeHead(404).end()
      const code = at.searchParams.get('code')
      const state = at.searchParams.get('state')
      if (!code || !state) {
        const reason = at.searchParams.get('error_description') ?? at.searchParams.get('error') ?? 'No code came back.'
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`The sign-in did not finish: ${reason}`)
        fail(new Error(`The sign-in did not finish: ${reason.slice(0, 200)}`))
        server.close()
        return
      }
      res
        .writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end(`Signed in${options.service ? ` to ${options.service}` : ''}. You can close this tab and return to Ramu.`)
      finish({ state, code })
      server.close()
    })
    const timer = setTimeout(
      () => {
        server.close()
        fail(new Error('The sign-in timed out. Start it again.'))
      },
      options.timeoutMs ?? 10 * 60_000,
    )
    timer.unref()
    void received.finally(() => clearTimeout(timer)).catch(() => {})
    server.once('error', () =>
      refuse(new Error(`Port ${port} on this computer is in use, and the sign-in's callback needs it.`)),
    )
    server.listen(port, 'localhost', () => {
      redirectUri = `http://localhost:${(server.address() as AddressInfo).port}/plugin/callback`
      ready({
        redirectUri,
        received,
        stop: () => {
          server.close()
          fail(new Error('Cancelled.'))
        },
      })
    })
  })
}
