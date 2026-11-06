import { createHash } from 'node:crypto'
import { blake3 } from '@noble/hashes/blake3'
import { bytesToHex } from '@noble/hashes/utils'

type Fetch = typeof fetch

/** One file of a static site, at its path from the site root. */
export interface SiteFile {
  path: string
  content: Buffer
}

/** Where a site went: its address, and the platform's id for it so the next deploy updates the same site. */
export interface Deployed {
  url: string
  siteId: string
}

export type StaticTarget = 'github-pages' | 'netlify' | 'vercel' | 'cloudflare-pages'

/**
 * A hosting platform that can take a folder of static files on the person's own account. Each call uses their token;
 * nothing is hosted by Ramu.
 */
export interface StaticHostingAdapter {
  target: StaticTarget
  name: string
  deploy(
    files: SiteFile[],
    site: { name: string; siteId?: string },
    token: string,
    signal?: AbortSignal,
  ): Promise<Deployed>
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

/** Netlify: a site, then a deploy that lists file digests and uploads the ones Netlify asks for. */
export function netlify(fetcher: Fetch = fetch): StaticHostingAdapter {
  const api = 'https://api.netlify.com/api/v1'
  return {
    target: 'netlify',
    name: 'Netlify',
    async deploy(files, site, token, signal) {
      let siteId = site.siteId
      if (!siteId) {
        const created = await call<{ id: string }>(
          fetcher,
          `${api}/sites`,
          {
            method: 'POST',
            token,
            body: JSON.stringify({ name: `${slug(site.name)}-${Date.now().toString(36)}` }),
            signal,
          },
          'creating the site',
        )
        siteId = created.id
      }
      const digests = Object.fromEntries(
        files.map((file) => [`/${file.path}`, createHash('sha1').update(file.content).digest('hex')]),
      )
      const deploy = await call<{ id: string; required?: string[]; ssl_url?: string; url?: string }>(
        fetcher,
        `${api}/sites/${siteId}/deploys`,
        { method: 'POST', token, body: JSON.stringify({ files: digests }), signal },
        'starting the deploy',
      )
      const required = new Set(deploy.required ?? [])
      for (const file of files)
        if (required.has(digests[`/${file.path}`]!))
          await call(
            fetcher,
            `${api}/deploys/${deploy.id}/files/${file.path}`,
            {
              method: 'PUT',
              token,
              body: new Uint8Array(file.content),
              headers: { 'Content-Type': 'application/octet-stream' },
              signal,
            },
            `uploading ${file.path}`,
          )
      const live = await call<{ ssl_url?: string; url?: string }>(
        fetcher,
        `${api}/sites/${siteId}`,
        { token, signal },
        'reading the site',
      )
      return { url: live.ssl_url ?? live.url ?? deploy.ssl_url ?? '', siteId }
    },
  }
}

/** Vercel: one production deployment with the files inline, under a project named after the page. */
export function vercel(fetcher: Fetch = fetch): StaticHostingAdapter {
  return {
    target: 'vercel',
    name: 'Vercel',
    async deploy(files, site, token, signal) {
      const name = site.siteId ?? slug(site.name)
      const deployment = await call<{ id: string; url: string; alias?: string[] }>(
        fetcher,
        'https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1',
        {
          method: 'POST',
          token,
          body: JSON.stringify({
            name,
            target: 'production',
            projectSettings: { framework: null },
            files: files.map((file) => ({
              file: file.path,
              data: file.content.toString('base64'),
              encoding: 'base64',
            })),
          }),
          signal,
        },
        'deploying',
      )
      // The production alias is the project name; a deployment without one is still reachable at its own address.
      // The project's production domain is public; team-scoped and per-deployment addresses sit behind Vercel's
      // login when deployment protection is on. Production domains are assigned just after the deployment returns,
      // so they are read from the project.
      void deployment
      const domains = await call<{ domains?: { name: string }[] }>(
        fetcher,
        `https://api.vercel.com/v9/projects/${encodeURIComponent(name)}/domains`,
        { token, signal },
        'reading the project domains',
      ).catch(() => ({ domains: [] }))
      const alias =
        (domains.domains ?? []).map((entry) => entry.name).sort((a, b) => a.length - b.length)[0] ??
        `${name}.vercel.app`
      return { url: `https://${alias}`, siteId: name }
    },
  }
}

/** GitHub Pages: a public repository with the files on main, served from its root, through the saved GitHub login. */
export function githubPages(fetcher: Fetch = fetch): StaticHostingAdapter {
  const api = 'https://api.github.com'
  return {
    target: 'github-pages',
    name: 'GitHub Pages',
    async deploy(files, site, token, signal) {
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

/** Cloudflare's asset key: the first 32 hex digits of BLAKE3 over the base64 content and the file extension. */
export function cloudflareAssetHash(file: SiteFile): string {
  const extension = file.path.includes('.') ? file.path.split('.').pop()! : ''
  return bytesToHex(blake3(new TextEncoder().encode(file.content.toString('base64') + extension))).slice(0, 32)
}

/** Cloudflare Pages direct upload: a project, its assets by hash, then a deployment whose manifest names them. */
export function cloudflarePages(fetcher: Fetch = fetch): StaticHostingAdapter {
  const api = 'https://api.cloudflare.com/client/v4'
  return {
    target: 'cloudflare-pages',
    name: 'Cloudflare Pages',
    async deploy(files, site, token, signal) {
      // A token limited to Pages often cannot list accounts, so it is saved as `<account id>:<token>`.
      const [given, secret] = token.includes(':') ? (token.split(':', 2) as [string, string]) : [null, token]
      token = secret
      let account = given
      if (!account) {
        const accounts = await call<{ result: { id: string }[] }>(
          fetcher,
          `${api}/accounts`,
          { token, signal },
          'reading the account',
        )
        account = accounts.result[0]?.id ?? null
      }
      if (!account)
        throw new Error(
          'The token can see no Cloudflare account. Add your account ID (shown in the Cloudflare dashboard) with the token.',
        )
      const project = site.siteId ?? slug(site.name)
      if (!site.siteId)
        await call(
          fetcher,
          `${api}/accounts/${account}/pages/projects`,
          { method: 'POST', token, body: JSON.stringify({ name: project, production_branch: 'main' }), signal },
          'creating the project',
        )
      const upload = await call<{ result: { jwt: string } }>(
        fetcher,
        `${api}/accounts/${account}/pages/projects/${project}/upload-token`,
        { token, signal },
        'starting the upload',
      )
      const jwt = upload.result.jwt
      const manifest: Record<string, string> = {}
      const payload = files.map((file) => {
        const key = cloudflareAssetHash(file)
        manifest[`/${file.path}`] = key
        const extension = file.path.split('.').pop() ?? ''
        const contentType =
          {
            html: 'text/html',
            css: 'text/css',
            js: 'application/javascript',
            json: 'application/json',
            svg: 'image/svg+xml',
            png: 'image/png',
          }[extension] ?? 'application/octet-stream'
        return { key, value: file.content.toString('base64'), metadata: { contentType }, base64: true }
      })
      await call(
        fetcher,
        `${api}/pages/assets/upload`,
        { method: 'POST', token: jwt, body: JSON.stringify(payload), signal },
        'uploading files',
      )
      await call(
        fetcher,
        `${api}/pages/assets/upsert-hashes`,
        { method: 'POST', token: jwt, body: JSON.stringify({ hashes: Object.values(manifest) }), signal },
        'recording files',
      )
      const form = new FormData()
      form.append('manifest', JSON.stringify(manifest))
      form.append('branch', 'main')
      await call(
        fetcher,
        `${api}/accounts/${account}/pages/projects/${project}/deployments`,
        { method: 'POST', token, body: form, signal },
        'creating the deployment',
      )
      return { url: `https://${project}.pages.dev`, siteId: project }
    },
  }
}

export const STATIC_TARGETS: StaticTarget[] = ['github-pages', 'netlify', 'vercel', 'cloudflare-pages']

export function staticAdapter(target: StaticTarget, fetcher: Fetch = fetch): StaticHostingAdapter {
  switch (target) {
    case 'github-pages':
      return githubPages(fetcher)
    case 'netlify':
      return netlify(fetcher)
    case 'vercel':
      return vercel(fetcher)
    case 'cloudflare-pages':
      return cloudflarePages(fetcher)
  }
}
