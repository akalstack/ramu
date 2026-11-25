// GitHub Pages publishing for Publish to the web: a page's files in a public repository of the person's own GitHub
// account, served from its root. Nothing is hosted by Ramu.

type Fetch = typeof fetch

/** One file of a static site, at its path from the site root. */
interface SiteFile {
  path: string
  content: Buffer
}

/** Where a site went: its address, and the id the next publish updates. */
interface Deployed {
  url: string
  siteId: string
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'ramu-page'

async function call<T>(
  fetcher: Fetch,
  url: string,
  init: RequestInit & { token: string; scheme?: 'Bearer' | 'token' },
  what: string,
): Promise<T> {
  const response = await fetcher(url, {
    ...init,
    headers: {
      Authorization: `${init.scheme ?? 'Bearer'} ${init.token}`,
      ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  })
  if (!response.ok) {
    // Platform error bodies can echo request details; say only what failed and the status.
    throw new Error(
      response.status === 401 || response.status === 403
        ? `The token was refused while ${what}. Check it has deploy access.`
        : `The platform answered ${response.status} while ${what}.`,
    )
  }
  const text = await response.text()
  return (text ? JSON.parse(text) : {}) as T
}

/** GitHub Pages: a public repository with the files on main, served from its root, through the saved GitHub login. */
export function githubPages(fetcher: Fetch = fetch) {
  const api = 'https://api.github.com'
  return {
    async deploy(
      files: SiteFile[],
      site: { name: string; siteId?: string },
      token: string,
      signal?: AbortSignal,
    ): Promise<Deployed> {
      const user = await call<{ login: string }>(
        fetcher,
        `${api}/user`,
        { token, scheme: 'token', signal },
        'reading the account',
      )
      const repo = site.siteId ?? slug(site.name)
      if (!site.siteId)
        await call(
          fetcher,
          `${api}/user/repos`,
          {
            method: 'POST',
            token,
            scheme: 'token',
            body: JSON.stringify({ name: repo, description: 'Published from Ramu', auto_init: true, private: false }),
            signal,
          },
          'creating the repository',
        )
      for (const file of files) {
        const path = file.path.split('/').map(encodeURIComponent).join('/')
        // An existing file needs its blob sha to be replaced.
        const existing = await fetcher(`${api}/repos/${user.login}/${repo}/contents/${path}`, {
          headers: { Authorization: `token ${token}` },
          signal,
        })
        const sha = existing.ok ? ((await existing.json()) as { sha?: string }).sha : undefined
        await call(
          fetcher,
          `${api}/repos/${user.login}/${repo}/contents/${path}`,
          {
            method: 'PUT',
            token,
            scheme: 'token',
            body: JSON.stringify({
              message: 'Publish from Ramu',
              content: file.content.toString('base64'),
              ...(sha ? { sha } : {}),
            }),
            signal,
          },
          `writing ${file.path}`,
        )
      }
      const pages = await fetcher(`${api}/repos/${user.login}/${repo}/pages`, {
        headers: { Authorization: `token ${token}` },
        signal,
      })
      if (!pages.ok)
        await call(
          fetcher,
          `${api}/repos/${user.login}/${repo}/pages`,
          {
            method: 'POST',
            token,
            scheme: 'token',
            body: JSON.stringify({ source: { branch: 'main', path: '/' } }),
            signal,
          },
          'turning on GitHub Pages',
        )
      return { url: `https://${user.login.toLowerCase()}.github.io/${repo}/`, siteId: repo }
    },
  }
}
