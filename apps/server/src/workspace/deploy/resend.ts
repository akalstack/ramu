// Resend for sending email, with the person's full-access API key. Ramu does not hand that key to the app: it creates
// a sending-only key named after the project for production, and a second one for previews and development, so a
// preview can never use production's key and neither can manage the account. Resend shows a key's value only when it
// is created, so a creation whose reply is lost cannot be recovered; that key is removed on Resend's page.
import { DeployError, platformCall, type HostingAuth } from './adapter'
import { registerResourceAdapter, type ResourceAdapter } from './resource'

/** How many pages of 100 emails a usage reading walks before it says the month is too large to count. */
const USAGE_PAGES = 100

/** Resend, reached at `api` (the real API unless a test points it at a fake server). */
export function resendAdapter(
  options: { api?: string; fetch?: typeof fetch; pause?: (ms: number) => Promise<void> } = {},
): ResourceAdapter {
  const api = options.api ?? 'https://api.resend.com'
  const fetcher = options.fetch ?? fetch
  const pause = options.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const call = <T>(path: string, auth: HostingAuth, what: string, init: RequestInit = {}) =>
    platformCall<T>('Resend', fetcher, `${api}${path}`, { ...init, token: auth.token }, what)
  const key = async (auth: HostingAuth, name: string) => {
    const created = await call<{ id: string; token: string }>('/api-keys', auth, 'creating a sending key', {
      method: 'POST',
      body: JSON.stringify({ name: name.slice(0, 50), permission: 'sending_access' }),
    })
    return { RESEND_API_KEY: created.token }
  }
  return {
    id: 'resend',
    name: 'Resend',
    kind: 'email',
    tokenPage: 'https://resend.com/api-keys',
    plans: [
      {
        id: 'default',
        name: 'Your Resend plan',
        summary:
          'A sending-only key for production and another for previews; add your domain on Resend to send from it.',
      },
    ],
    async account(auth) {
      // Listing domains needs a full-access key, which creating sending keys needs too.
      const { data } = await call<{ data?: { id: string; name: string }[] }>('/domains', auth, 'reading the account')
      const first = data?.[0]
      return {
        id: first?.id ?? 'resend',
        name: first?.name ?? 'Resend',
        defaultScope: null,
        broadScope: null,
        expiresAt: null,
      }
    },
    // The resource is named by its production key, so the preview key can be named after it.
    provision: async (auth, target) => ({
      id: target.name,
      name: target.name,
      variables: await key(auth, target.name),
    }),
    find: async () => null,
    page: () => 'https://resend.com/api-keys',
    branch: (auth, id, name) => key(auth, `${id}-${name}`),
    async usage(auth) {
      // Resend reports no usage totals, so the account's emails this calendar month are counted from its list, newest
      // first; its plan's monthly and daily limits are not in the API, so none is shown or guessed.
      const now = new Date()
      const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
      let sent = 0
      let after: string | undefined
      for (let page = 0; page < USAGE_PAGES; page++) {
        const list = await call<{ has_more?: boolean; data?: { id: string; created_at: string }[] }>(
          `/emails?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`,
          auth,
          'reading sent emails',
        )
        const emails = list.data ?? []
        const thisMonth = emails.filter((email) => Date.parse(email.created_at) >= start)
        sent += thisMonth.length
        if (thisMonth.length < emails.length || !list.has_more || !emails.length)
          return {
            period: { start, end: null },
            figures: [{ metric: 'service', service: 'Emails sent', used: sent, unit: 'emails', limit: null }],
            billingPage: 'https://resend.com/settings/usage',
          }
        after = emails.at(-1)!.id
        // Resend allows an account about two requests a second.
        await pause(600)
      }
      throw new DeployError(
        `This Resend account sent more than ${USAGE_PAGES * 100} emails this month, more than Ramu counts. Open billing to see it on Resend.`,
        null,
      )
    },
  }
}

registerResourceAdapter(resendAdapter())
