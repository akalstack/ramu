import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { pagesBuild, pagesWorkflow } from '@ramu/shared/pagesDeploy'
import { githubPagesAdapter } from '../src/workspace/deploy/githubPages'

describe('the GitHub Pages deploy job', () => {
  it('builds with the lockfile’s package manager into the framework’s folder, or publishes plain files', () => {
    const vite = JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '^6' } })
    expect(pagesBuild(['package.json', 'pnpm-lock.yaml'], vite)).toEqual({ manager: 'pnpm', output: 'dist' })
    expect(
      pagesBuild(['package.json'], JSON.stringify({ scripts: { build: 'x' }, dependencies: { next: '15' } })),
    ).toEqual({ manager: 'npm', output: 'out' })
    expect(pagesBuild(['package.json'], JSON.stringify({ scripts: { start: 'x' } }))).toBeNull()
    expect(pagesBuild(['index.html'], null)).toBeNull()
  })

  it('builds after CI at the chosen commit and publishes with GitHub’s Pages actions', () => {
    const workflow = parse(
      pagesWorkflow({ defaultBranch: 'main', afterCi: true, build: { manager: 'pnpm', output: 'dist' } }),
    ) as {
      on: Record<string, unknown>
      permissions: Record<string, string>
      jobs: Record<string, { needs?: string; steps: { uses?: string; run?: string; with?: Record<string, string> }[] }>
    }
    expect(workflow.on.workflow_run).toEqual({ workflows: ['CI'], types: ['completed'], branches: ['main'] })
    expect(workflow.permissions).toEqual({ contents: 'read', pages: 'write', 'id-token': 'write' })
    const build = workflow.jobs.build!.steps
    expect(build.find((step) => step.run?.includes('pnpm install'))).toBeTruthy()
    expect(build.find((step) => step.uses === 'actions/upload-pages-artifact@v3')?.with).toEqual({ path: 'dist' })
    expect(workflow.jobs.deploy!.needs).toBe('build')
    expect(workflow.jobs.deploy!.steps[0]!.uses).toBe('actions/deploy-pages@v4')
    const plain = parse(pagesWorkflow({ defaultBranch: 'main', afterCi: false, build: null })) as typeof workflow
    expect(plain.on.push).toEqual({ branches: ['main'] })
    expect(plain.jobs.build!.steps.some((step) => step.uses === 'actions/setup-node@v4')).toBe(false)
  })
})

describe('the GitHub Pages adapter', () => {
  it('reads deploys from the workflow’s runs and the address from the Pages site, through the repository’s GitHub account', async () => {
    const urls: string[] = []
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      urls.push(url)
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer gh_repo')
      if (url.endsWith('/pages')) return new Response(JSON.stringify({ html_url: 'https://ana.github.io/site/' }))
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 7,
              status: 'completed',
              conclusion: 'success',
              head_sha: 'a'.repeat(40),
              head_branch: 'main',
              display_title: 'Add pricing',
              created_at: '2026-11-07T10:00:00Z',
              path: '.github/workflows/pages-deploy.yml',
              html_url: 'https://github.com/ana/site/actions/runs/7',
            },
          ],
        }),
      )
    }) as typeof fetch
    const pages = githubPagesAdapter({ api: 'https://gh.test', fetch: fetcher })
    const auth = { token: 'github', github: async () => 'gh_repo' }
    const site = { siteId: 'ana/site', siteName: 'ana/site' }
    expect(await pages.account(auth)).toMatchObject({ id: 'github', name: 'your GitHub sign-in' })
    expect(await pages.productionUrl(auth, site)).toBe('https://ana.github.io/site/')
    const [deployment] = await pages.listDeployments(auth, site, 5)
    expect(deployment).toMatchObject({ id: '7', state: 'ready', production: true })
    expect(urls[1]).toBe('https://gh.test/repos/ana/site/actions/workflows/pages-deploy.yml/runs?per_page=15')
    expect(Object.keys(pages.capabilities).sort()).toEqual(['deployProduction', 'rollback'])
  })
})
