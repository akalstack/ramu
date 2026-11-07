// Resend for sending email, with the person's full-access API key. Ramu does not hand that key to the app: it creates
// a sending-only key named after the project for production, and a second one for previews and development, so a
// preview can never use production's key and neither can manage the account. Resend shows a key's value only when it
// is created, so a creation whose reply is lost cannot be recovered; that key is removed on Resend's page.
import { platformCall, type HostingAuth } from './adapter'
import { registerResourceAdapter, type ResourceAdapter } from './resource'

/** Resend, reached at `api` (the real API unless a test points it at a fake server). */
export function resendAdapter(options: { api?: string; fetch?: typeof fetch } = {}): ResourceAdapter {
  const api = options.api ?? 'https://api.resend.com'
  const fetcher = options.fetch ?? fetch
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
  }
}

registerResourceAdapter(resendAdapter())
