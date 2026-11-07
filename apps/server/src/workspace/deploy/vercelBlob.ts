// File storage on Vercel Blob for a project deployed to Vercel, on the same Vercel sign-in. The store is created for
// the project, which Vercel connects to it and gives `BLOB_READ_WRITE_TOKEN`; Vercel keeps the token, so Ramu sets no
// values and checks only that Vercel reports the variable on the project. Previews read and write the same store.
import { platformCall, type HostingAuth } from './adapter'
import { registerResourceAdapter, type ResourceAdapter } from './resource'

interface BlobStore {
  id?: string
  name?: string
  projectsMetadata?: { projectId: string; environmentVariables?: string[] }[]
}

/** Vercel Blob, reached at `api` (the real API unless a test points it at a fake server). */
export function vercelBlobAdapter(options: { api?: string; fetch?: typeof fetch } = {}): ResourceAdapter {
  const api = options.api ?? 'https://api.vercel.com'
  const fetcher = options.fetch ?? fetch
  const call = <T>(path: string, auth: HostingAuth, what: string, init: RequestInit = {}) => {
    const params = new URLSearchParams(auth.scope ? { teamId: auth.scope } : {})
    return platformCall<T>(
      'Vercel',
      fetcher,
      `${api}${path}${params.size ? `?${params.toString()}` : ''}`,
      { ...init, token: auth.token },
      what,
    )
  }
  return {
    id: 'vercel-blob',
    name: 'Vercel Blob',
    kind: 'storage',
    tokenPage: 'https://vercel.com/account/settings/tokens',
    plans: [
      {
        id: 'default',
        name: 'Your Vercel plan',
        summary: 'A private Blob store connected to the project; Vercel sets BLOB_READ_WRITE_TOKEN on it.',
      },
    ],
    async account(auth) {
      const { user } = await call<{ user: { id: string; username?: string } }>('/v2/user', auth, 'reading the account')
      return { id: user.id, name: user.username ?? user.id, defaultScope: null, broadScope: null, expiresAt: null }
    },
    async provision(auth, target) {
      if (!target.site) throw new Error('Link the project to Vercel first.')
      const { store } = await call<{ store: BlobStore | null }>(
        '/storage/stores/blob',
        auth,
        'creating the Blob store',
        {
          method: 'POST',
          body: JSON.stringify({ name: target.name.slice(0, 70), access: 'private', projectId: target.site }),
        },
      )
      if (!store?.id) throw new Error('Vercel did not report the Blob store it created. Check the team’s Storage page.')
      const connected = store.projectsMetadata?.some(
        (entry) => entry.projectId === target.site && entry.environmentVariables?.includes('BLOB_READ_WRITE_TOKEN'),
      )
      if (!connected)
        throw new Error(
          `Vercel created the Blob store ${store.name ?? target.name} but did not connect it to the project. Connect it on the project's Storage page.`,
        )
      return { id: store.id, name: store.name ?? target.name, variables: {} }
    },
    // Ramu holds no values for it, so a store whose reply was lost is connected on Vercel's Storage page instead.
    find: async () => null,
    page: () => 'https://vercel.com/dashboard/stores',
  }
}

registerResourceAdapter(vercelBlobAdapter())
