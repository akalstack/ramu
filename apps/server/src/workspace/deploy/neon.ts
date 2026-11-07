// Neon's REST API with the person's own API key. A project is the database; production uses its default branch, and
// previews and development share a `preview` branch, a copy-on-write copy that never touches production data.
import { platformCall, ReplyLostError, type HostingAuth } from './adapter'
import { registerResourceAdapter, type ProvisionedResource, type ResourceAdapter } from './resource'

interface NeonProject {
  id: string
  name: string
  synthetic_storage_size?: number | null
  compute_time_seconds?: number | null
}

interface NeonBranch {
  id: string
  name: string
  default?: boolean
  primary?: boolean
}

/** Neon, reached at `api` (the real API unless a test points it at a fake server). */
export function neonAdapter(options: { api?: string; fetch?: typeof fetch } = {}): ResourceAdapter {
  const api = options.api ?? 'https://console.neon.tech/api/v2'
  const fetcher = options.fetch ?? fetch
  const call = <T>(path: string, auth: HostingAuth, what: string, init: RequestInit = {}) =>
    platformCall<T>('Neon', fetcher, `${api}${path}`, { ...init, token: auth.token }, what)
  const project = (id: string) => `/projects/${encodeURIComponent(id)}`
  const branches = async (auth: HostingAuth, id: string) =>
    (await call<{ branches?: NeonBranch[] }>(`${project(id)}/branches`, auth, 'reading the branches')).branches ?? []
  /** A branch's pooled address for the app and its direct one for migrations, which a pooler cannot run. */
  const connection = async (auth: HostingAuth, id: string, branch: NeonBranch) => {
    const { databases } = await call<{ databases?: { name: string; owner_name: string }[] }>(
      `${project(id)}/branches/${encodeURIComponent(branch.id)}/databases`,
      auth,
      'reading the databases',
    )
    const database = databases?.[0]
    if (!database) throw new Error('The Neon project has no database yet. Create one on Neon, then try again.')
    const uri = async (pooled: boolean) => {
      const query = new URLSearchParams({
        branch_id: branch.id,
        database_name: database.name,
        role_name: database.owner_name,
        pooled: String(pooled),
      })
      const { uri: value } = await call<{ uri: string }>(
        `${project(id)}/connection_uri?${query.toString()}`,
        auth,
        'reading the connection address',
      )
      return value
    }
    const [pooled, direct] = await Promise.all([uri(true), uri(false)])
    return { DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: direct }
  }
  const main = async (auth: HostingAuth, id: string) => {
    const list = await branches(auth, id)
    const found = list.find((branch) => branch.default ?? branch.primary) ?? list[0]
    if (!found) throw new Error('The Neon project has no branch yet. Try again in a moment.')
    return found
  }
  const resource = async (auth: HostingAuth, found: { id: string; name: string }): Promise<ProvisionedResource> => ({
    id: found.id,
    name: found.name,
    variables: await connection(auth, found.id, await main(auth, found.id)),
  })
  return {
    id: 'neon',
    name: 'Neon',
    kind: 'database',
    tokenPage: 'https://console.neon.tech/app/settings/api-keys',
    plans: [
      {
        id: 'default',
        name: 'Your Neon plan',
        summary: 'Postgres on your account’s plan; the free plan includes 0.5 GB and sleeps when idle.',
      },
    ],
    async account(auth) {
      const user = await call<{ id: string; name?: string | null; email?: string | null; login?: string | null }>(
        '/users/me',
        auth,
        'reading the account',
      )
      // Neon API keys reach every project of the account; there is no narrower kind for creating projects.
      return {
        id: user.id,
        name: user.email || user.name || user.login || user.id,
        defaultScope: null,
        broadScope: null,
        expiresAt: null,
      }
    },
    async provision(auth, target) {
      const { project: created } = await call<{ project: NeonProject }>('/projects', auth, 'creating the database', {
        method: 'POST',
        body: JSON.stringify({ project: { name: target.name } }),
      })
      return resource(auth, created)
    },
    async find(auth, name) {
      const { projects } = await call<{ projects?: NeonProject[] }>(
        `/projects?${new URLSearchParams({ search: name, limit: '50' }).toString()}`,
        auth,
        'listing projects',
      )
      const found = projects?.find((entry) => entry.name === name)
      return found ? resource(auth, found) : null
    },
    page: (id) => `https://console.neon.tech/app/projects/${encodeURIComponent(id)}`,
    async branch(auth, id, name) {
      const existing = (await branches(auth, id)).find((branch) => branch.name === name)
      if (existing) return connection(auth, id, existing)
      try {
        const { branch } = await call<{ branch: NeonBranch }>(`${project(id)}/branches`, auth, 'creating a branch', {
          method: 'POST',
          body: JSON.stringify({ branch: { name }, endpoints: [{ type: 'read_write' }] }),
        })
        return connection(auth, id, branch)
      } catch (error) {
        if (!(error instanceof ReplyLostError)) throw error
        // The branch may have been made before the reply was lost; one made since is used instead of a second one.
        const made = (await branches(auth, id)).find((branch) => branch.name === name)
        if (!made) throw error
        return connection(auth, id, made)
      }
    },
    async usage(auth, id) {
      const { project: found } = await call<{ project: NeonProject }>(project(id), auth, 'reading usage')
      return {
        storageBytes: found.synthetic_storage_size ?? null,
        computeSeconds: found.compute_time_seconds ?? null,
      }
    },
  }
}

registerResourceAdapter(neonAdapter())
