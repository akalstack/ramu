// Salesforce as a named service a Dashboard or App artifact reads, through the person's own connected app: they
// register it in their org with Ramu's callback address and paste its consumer key in Settings, and Ramu runs
// Salesforce's browser sign-in on the host with PKCE (no consumer secret). The access token is saved with the org's
// address as `https://acme.my.salesforce.com|<token>`, and the refresh token beside it in the credential store. Ramu
// calls only the REST API's version list (to check the sign-in), the user info endpoint (to name the account) and
// SOQL queries, which read and never write.
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { SALESFORCE_CALLBACK_PORT } from '@ramu/shared/types/deploy'
import { platformCall, type HostingAuth } from '../workspace/deploy/adapter'

type Cell = string | number | null

const API_VERSION = 'v62.0'

/** The org's address and the access token from a saved `address|token`. */
export function salesforceAuth(auth: HostingAuth): { origin: string; token: string } {
  const separator = auth.token.lastIndexOf('|')
  const address = separator > 0 ? auth.token.slice(0, separator) : ''
  const token = separator > 0 ? auth.token.slice(separator + 1) : ''
  let url: URL | null
  try {
    url = new URL(address)
  } catch {
    url = null
  }
  const loopback = url?.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
  if (!url || !token || (url.protocol !== 'https:' && !loopback))
    throw new Error('Sign in to Salesforce again in Settings → Git → Hosting accounts.')
  return { origin: url.origin, token }
}

/** A SOQL query a table or page asks for: read-only by construction, since only SELECT reaches the query endpoint. */
export interface SalesforceQuery {
  soql: string
}

/** A field of a record by a column name, following relationships such as `Account.Name`. */
const field = (record: Record<string, unknown>, column: string): Cell => {
  let value: unknown = record
  for (const part of column.split('.')) value = (value as Record<string, unknown> | null)?.[part]
  return value === null || value === undefined
    ? null
    : typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? value.slice(0, 200)
        : typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value).slice(0, 200)
}

export function salesforceConnector(options: { fetch?: typeof fetch } = {}) {
  const fetcher = options.fetch ?? fetch
  const call = <T>(auth: HostingAuth, path: string, what: string) => {
    const { origin, token } = salesforceAuth(auth)
    return platformCall<T>('Salesforce', fetcher, `${origin}${path}`, { token }, what)
  }
  return {
    name: 'Salesforce',
    tokenPage: 'https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm',
    kind: 'service' as const,
    async account(auth: HostingAuth) {
      await call(auth, '/services/data/', 'checking the sign-in')
      const user = await call<{ user_id?: string; preferred_username?: string; organization_id?: string }>(
        auth,
        '/services/oauth2/userinfo',
        'reading the account',
      )
      return {
        id: `${user.organization_id ?? ''}:${user.user_id ?? ''}`,
        name: user.preferred_username ?? new URL(salesforceAuth(auth).origin).host,
        defaultScope: null,
        broadScope: null,
        expiresAt: null,
      }
    },
    /** Runs the SOQL query, following pages of results up to `limit` records, as the columns it names. */
    async query(auth: HostingAuth, spec: SalesforceQuery, columns: string[], limit: number): Promise<Cell[][]> {
      if (!/^\s*select\s/i.test(spec.soql)) throw new Error('A Salesforce query is a SOQL SELECT.')
      const rows: Cell[][] = []
      let next: string | null =
        `/services/data/${API_VERSION}/query?${new URLSearchParams({ q: spec.soql }).toString()}`
      while (next && rows.length < limit) {
        const page: { records?: Record<string, unknown>[]; nextRecordsUrl?: string } = await call<{
          records?: Record<string, unknown>[]
          nextRecordsUrl?: string
        }>(auth, next, 'running the query')
        for (const record of page.records ?? []) {
          rows.push(columns.map((column) => field(record, column)))
          if (rows.length >= limit) break
        }
        // Salesforce returns a path on the same org for the next batch; anything else ends the read.
        next = page.nextRecordsUrl?.startsWith('/services/data/') ? page.nextRecordsUrl : null
      }
      return rows
    },
  }
}

export const salesforce = salesforceConnector()

/** A finished Salesforce sign-in: the token saved with the org's address, and how to renew it. */
export interface SalesforceGrant {
  token: string
  refreshToken: string
  expiresAt: number
  oauthClient: { url: string; client: string }
}

/**
 * Salesforce's browser sign-in with PKCE through the person's connected app: listens on the loopback callback, hands
 * back the link to open, and resolves once Salesforce redirects there with a code, which is exchanged for tokens.
 */
export function startSalesforceSignIn(options: {
  clientId: string
  sandbox: boolean
  fetch?: typeof fetch
  port?: number
  timeoutMs?: number
}): Promise<{ url: string; done: Promise<SalesforceGrant>; stop(): void }> {
  const login = options.sandbox ? 'https://test.salesforce.com' : 'https://login.salesforce.com'
  const port = options.port ?? SALESFORCE_CALLBACK_PORT
  let callback = `http://localhost:${port}/salesforce/callback`
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('base64url')
  const fetcher = options.fetch ?? fetch
  const link = () =>
    `${login}/services/oauth2/authorize?${new URLSearchParams({
      response_type: 'code',
      client_id: options.clientId,
      redirect_uri: callback,
      scope: 'api refresh_token',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    }).toString()}`
  return new Promise((ready, refuse) => {
    let finish: (grant: SalesforceGrant) => void = () => {}
    let fail: (error: Error) => void = () => {}
    const done = new Promise<SalesforceGrant>((resolve, reject) => {
      finish = resolve
      fail = reject
    })
    const server: Server = createServer((req, res) => {
      const at = new URL(req.url ?? '/', callback)
      if (at.pathname !== '/salesforce/callback') return void res.writeHead(404).end()
      const code = at.searchParams.get('code')
      if (at.searchParams.get('state') !== state || !code) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end('This sign-in was not started here.')
        return
      }
      res
        .writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end('Signed in to Salesforce. You can close this tab and return to Ramu.')
      void (async () => {
        try {
          const response = await fetcher(`${login}/services/oauth2/token`, {
            method: 'POST',
            redirect: 'error',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              client_id: options.clientId,
              redirect_uri: callback,
              code_verifier: verifier,
            }).toString(),
          })
          const tokens = (await response.json().catch(() => ({}))) as {
            access_token?: string
            refresh_token?: string
            instance_url?: string
          }
          if (!response.ok || !tokens.access_token || !tokens.refresh_token || !tokens.instance_url)
            throw new Error(
              'Salesforce refused the sign-in. Check that the connected app allows the api and refresh_token scopes and this callback.',
            )
          finish({
            token: `${new URL(tokens.instance_url).origin}|${tokens.access_token}`,
            refreshToken: tokens.refresh_token,
            // Salesforce reports no lifetime; renewing hourly stays inside any session timeout an org sets.
            expiresAt: Date.now() + 60 * 60_000,
            oauthClient: { url: `${login}/services/oauth2/token`, client: options.clientId },
          })
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)))
        } finally {
          server.close()
        }
      })()
    })
    const timer = setTimeout(
      () => {
        server.close()
        fail(new Error('The Salesforce sign-in timed out. Start it again.'))
      },
      options.timeoutMs ?? 10 * 60_000,
    )
    timer.unref()
    void done.catch(() => {}).finally(() => clearTimeout(timer))
    server.once('error', () =>
      refuse(new Error(`Port ${port} on this computer is in use, and the connected app's callback needs it.`)),
    )
    // Bound to loopback only, by the name the callback uses, so the browser reaches it on IPv4 or IPv6.
    server.listen(port, 'localhost', () => {
      // A test asks for any free port; the callback names the one given.
      callback = `http://localhost:${(server.address() as AddressInfo).port}/salesforce/callback`
      ready({
        url: link(),
        done,
        stop: () => {
          server.close()
          fail(new Error('Cancelled.'))
        },
      })
    })
  })
}
