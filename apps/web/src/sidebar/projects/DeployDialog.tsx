import { useCallback, useEffect, useState } from 'react'
import { accountBrand } from '@ramu/shared/brands'
import { accountName, canRollBackTo, DEPLOYMENT_STATE, deployText } from '@ramu/shared/deployText'
import type {
  Deployment,
  HostingAccount,
  HostingPlatform,
  ProjectDeployment,
  Project,
  Repository,
} from '@ramu/shared/types'
import { isHostingPlatform } from '@ramu/shared/types/deploy'
import { BrandIcon } from '@/components/brand-icon'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { RowButton } from '@/components/row-button'
import { Dialog } from '../../Menu'
import { t, useLanguage } from '../../i18n'
import { invoke as openOnThisComputer } from '../../ipc'
import { ServerConnect } from '../../settings/ServerConnect'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'
import { projectCtx } from '../../workspace/workspace'
import { openPublishRepository } from '../../git/PublishRepositoryHost'
import { CiSetupSection } from './CiSetup'
import { DatabaseSection } from './Database'
import { DomainsSection } from './Domains'
import { EnvSyncSection } from './EnvSync'
import { ReleaseSection } from './Release'
import { UptimeSection } from './Uptime'
import { LocalAppSection } from './LocalApp'
import { UsageSection } from './Usage'

const open = (url: string) => void openOnThisComputer('app.openExternal', url)

/**
 * Deploy: where the project lives, linking a repository through the platform's Git integration, and its latest
 * deployments. Pressing Deploy to production and confirming is the person's approval.
 */
export function DeployDialog({
  project,
  repos,
  onClose,
}: {
  project: Pick<Project, 'id' | 'name'>
  repos: Repository[]
  onClose: () => void
}) {
  useLanguage()
  const host = useHost()
  const [status, setStatus] = useState<ProjectDeployment | null>(null)
  const [accounts, setAccounts] = useState<(HostingAccount & { platform: HostingPlatform })[]>([])
  const [platform, setPlatform] = useState<HostingPlatform | null>(null)
  const [canAdminister, setCanAdminister] = useState(false)
  const [domain, setDomain] = useState('')
  const [pullRequest, setPullRequest] = useState<string | null>(null)
  const [repoId, setRepoId] = useState<string | null>(repos[0]?.id ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [rollback, setRollback] = useState<Deployment | null>(null)
  const [logs, setLogs] = useState<{ id: string; text: string } | null>(null)
  // A new database adds variables, so the sync table reads them again.
  const [provisioned, setProvisioned] = useState(0)
  const load = useCallback(() => {
    void Promise.all([host.invoke('deploy.project', project.id), host.invoke('deploy.accounts', false)]).then(
      ([next, summary]) => {
        setStatus(next)
        const hosting = summary.accounts.flatMap((account) =>
          isHostingPlatform(account.platform) ? [{ ...account, platform: account.platform }] : [],
        )
        setAccounts(hosting)
        setCanAdminister(summary.canAdminister)
        setPlatform(
          (current) =>
            current ??
            hosting.find((account) => account.platform === next.recommended)?.platform ??
            hosting.find((account) => account.connected)?.platform ??
            hosting[0]?.platform ??
            null,
        )
      },
      (reason) => setError(errorText(reason)),
    )
  }, [host, project.id])
  useEffect(load, [load])
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const binding = status?.binding ?? null
  // A repository with no remote cannot be linked yet, so the sheet offers to publish it to GitHub first.
  const [unpublished, setUnpublished] = useState(false)
  useEffect(() => {
    setUnpublished(false)
    if (!repoId || binding) return
    let live = true
    void host.invoke('git.status', projectCtx(project.id), repoId).then(
      (git) => {
        if (live) setUnpublished(git.remote === false)
      },
      () => {},
    )
    return () => {
      live = false
    }
  }, [host, project.id, repoId, binding])
  const publish = () => {
    const repo = repos.find((entry) => entry.id === repoId)
    if (!repo) return
    void openPublishRepository(projectCtx(project.id), repo.id, repo.name).then((published) => {
      if (!published) return
      setUnpublished(false)
      load()
    })
  }
  const account = accounts.find((entry) => entry.platform === (binding?.platform ?? platform))
  const canDeploy = !!binding && !!status?.capabilities.includes('deployProduction')
  const recommended = accounts.find((entry) => entry.platform === status?.recommended)
  // An Expo app ships through the stores, not a hosting platform, unless it is already linked to one.
  const storeOnly = !binding && status?.recommended === 'expo'

  const toServer = !binding && platform === 'server'
  // Fly.io has no Git integration: linking opens a pull request with the deploy job instead.
  const toFly = !binding && platform === 'fly'
  // GitHub Pages goes through the repository's GitHub sign-in, so it needs nothing connected first.
  const toPages = !binding && platform === 'github-pages'
  const toCloudflare = !binding && platform === 'cloudflare'
  const toWorkers = !binding && platform === 'cloudflare-workers'
  const confirm = () => {
    if (storeOnly) return onClose()
    if (toServer) {
      if (!repoId || !domain.trim()) return
      void run(async () => {
        const linked = await host.invoke('deploy.linkServer', project.id, repoId, domain.trim())
        setStatus(linked.deployment)
        setPullRequest(linked.pullRequest)
      })
      return
    }
    if (!binding) {
      if (!platform || !repoId) return
      void run(async () => {
        const linked = await host.invoke('deploy.link', project.id, platform, repoId)
        setStatus(linked.deployment)
        setPullRequest(linked.pullRequest)
      })
      return
    }
    if (!canDeploy) return onClose()
    if (!confirming) return setConfirming(true)
    void run(async () => {
      await host.invoke('deploy.production', project.id)
      setConfirming(false)
      load()
    })
  }

  return (
    <Dialog
      title={t('Deploy {0}', { 0: project.name })}
      confirmLabel={
        busy
          ? t('Working…')
          : storeOnly
            ? t('Done')
            : toServer
              ? t('Set up the server')
              : toFly
                ? t('Set up Fly.io')
                : toPages
                  ? t('Set up GitHub Pages')
                  : toCloudflare
                    ? t('Set up Cloudflare Pages')
                    : toWorkers
                      ? t('Set up Cloudflare Workers')
                      : !binding
                        ? t('Link repository')
                        : !canDeploy
                          ? t('Done')
                          : confirming
                            ? t('Deploy now')
                            : t('Deploy to production')
      }
      confirmDisabled={
        !status ||
        (!binding && unpublished) ||
        (!binding && !storeOnly && (!platform || !repoId || (!account?.connected && !toPages))) ||
        (toServer && !domain.trim())
      }
      busy={busy}
      error={error}
      onCancel={onClose}
      onConfirm={confirm}
    >
      {!status ? (
        <p className="text-muted-foreground">{t('Checking…')}</p>
      ) : storeOnly ? null : !binding ? (
        <>
          <p>
            {recommended && (recommended.platform === 'fly' || recommended.platform === 'server')
              ? t('{0} is recommended for this project’s stack.', {
                  0: accountName(t, recommended.platform, recommended.name),
                })
              : recommended
                ? t(
                    '{0} is recommended for this project’s stack. Ramu links it to the repository, so every pull request gets a preview and the default branch deploys to production.',
                    { 0: recommended.name },
                  )
                : t(
                    'Ramu links the platform to the repository, so every pull request gets a preview and the default branch deploys to production.',
                  )}
          </p>
          <div role="radiogroup" aria-label={t('Platform')} className="flex flex-col gap-0.5">
            {accounts.map((entry) => (
              <RowButton
                key={entry.platform}
                role="radio"
                aria-checked={platform === entry.platform}
                aria-pressed={platform === entry.platform}
                onClick={() => setPlatform(entry.platform)}
              >
                <BrandIcon brand={accountBrand(entry.platform)} />
                <span className="flex-1 text-foreground">{accountName(t, entry.platform, entry.name)}</span>
                <span className="text-caption text-muted-foreground">
                  {entry.platform === 'github-pages'
                    ? t('Uses the repository’s GitHub sign-in')
                    : entry.connected
                      ? t('Connected as {0}', { 0: entry.account ?? entry.name })
                      : entry.platform === 'server'
                        ? t('Connect it below')
                        : t('Connect it in Settings → Git → Hosting accounts')}
                </span>
              </RowButton>
            ))}
          </div>
          {repos.length > 1 && (
            <div role="radiogroup" aria-label={t('Repository')} className="mt-3 flex flex-col gap-0.5">
              {repos.map((repo) => (
                <RowButton
                  key={repo.id}
                  role="radio"
                  aria-checked={repoId === repo.id}
                  aria-pressed={repoId === repo.id}
                  onClick={() => setRepoId(repo.id)}
                >
                  <span className="flex-1 text-foreground">{repo.name}</span>
                </RowButton>
              ))}
            </div>
          )}
          {!binding && unpublished && (
            <div className="mt-3 flex items-center gap-2 text-caption">
              <span className="flex-1 text-muted-foreground">
                {t('This repository is not on GitHub yet. Publish it, then link it here.')}
              </span>
              <Button variant="outline" size="sm" onClick={publish}>
                {t('Publish to GitHub…')}
              </Button>
            </div>
          )}
          {!repos.length && (
            <p className="text-caption text-muted-foreground">
              {t('Connect a repository to this project and publish it to GitHub first.')}
            </p>
          )}
          {toFly && (
            <p className="m-0 mt-3 text-caption">
              {t(
                'Fly.io cannot watch a repository, so Ramu creates the app, keeps a deploy token limited to it in the repository’s GitHub Actions secrets, and opens a pull request with fly.toml, a Dockerfile when the repository has none, and the deploy job. Every merge to the default branch deploys; there are no preview deployments.',
              )}
            </p>
          )}
          {toPages && (
            <p className="m-0 mt-3 text-caption">
              {t(
                'For a static site: Ramu turns on GitHub Pages for the repository and opens a pull request with a deploy job that builds the site (or publishes its files as they are) with GitHub’s own Pages actions. Every merge to the default branch deploys; there are no preview deployments, and the site is public.',
              )}
            </p>
          )}
          {toCloudflare && (
            <p className="m-0 mt-3 text-caption">
              {t(
                'For a static site: Ramu creates the Pages project, keeps your Pages token and account id in the repository’s GitHub Actions secrets, and opens a pull request with a deploy job that builds the site and uploads it with wrangler. Every merge to the default branch deploys, and each pull request gets a preview.',
              )}
            </p>
          )}
          {toWorkers && (
            <p className="m-0 mt-3 text-caption">
              {t(
                'For a Worker with a wrangler config: Ramu keeps your Cloudflare token (which needs Workers Scripts edit) and account id in the repository’s GitHub Actions secrets and opens a pull request with a job that runs wrangler deploy. Every merge to the default branch deploys.',
              )}
            </p>
          )}
          {toServer && (
            <section aria-label={t('Own server')} className="mt-3 flex flex-col gap-2 border-t border-(--line) pt-3">
              <p className="m-0 text-caption">
                {t(
                  'The app runs on your server as a Docker container behind Caddy, which serves your domain over HTTPS. Every merge to the default branch deploys through GitHub Actions, so your server never needs Ramu running.',
                )}
              </p>
              <ServerConnect invoke={host.invoke} canAdminister={canAdminister} onConnected={load} />
              {account?.connected && (
                <label className="flex flex-col gap-1 text-caption">
                  {t('Domain')}
                  <Input
                    placeholder="app.example.com"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={domain}
                    onChange={(event) => setDomain(event.target.value)}
                  />
                  <span className="text-muted-foreground">
                    {t(
                      'Point the domain at the server with an A record; Caddy gets its HTTPS certificate once it does. Set up the server opens a pull request with the Dockerfile and deploy job the repository lacks, and keeps the SSH details in its GitHub Actions secrets.',
                    )}
                  </span>
                </label>
              )}
            </section>
          )}
        </>
      ) : (
        <>
          <p className="flex items-center gap-2">
            <BrandIcon brand={accountBrand(binding.platform)} />
            <span className="flex-1">
              {account ? accountName(t, account.platform, account.name) : binding.platform} · {binding.siteName}
              {binding.repository ? ` · ${binding.repository}` : ''}
            </span>
          </p>
          {status.productionUrl && (
            <p className="flex items-center gap-2">
              <span className="flex-1 truncate">{t('Live at {0}', { 0: status.productionUrl })}</span>
              <Button size="sm" variant="secondary" onClick={() => open(status.productionUrl!)}>
                {t('Open')}
              </Button>
            </p>
          )}
          {status.error && (
            <p role="alert" className="text-caption text-destructive">
              {status.error.message}
            </p>
          )}
          {pullRequest && (
            <p role="status" className="flex items-center gap-2 text-caption">
              <span className="flex-1">{t('Merge the pull request to deploy; every later merge deploys again.')}</span>
              <Button size="sm" variant="secondary" onClick={() => open(pullRequest)}>
                {t('Open pull request')}
              </Button>
            </p>
          )}
          {confirming && (
            <p role="status" className="text-caption">
              {t('This builds {0} and replaces what visitors see at {1}.', {
                0: binding.productionBranch,
                1: status.productionUrl ?? binding.siteName,
              })}
            </p>
          )}
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t('Latest deployments')}>
            {status.deployments.map((deployment) => (
              <li key={deployment.id} className="flex flex-col gap-1 text-caption">
                <span className="flex items-center gap-2">
                  <strong>{t(DEPLOYMENT_STATE[deployment.state])}</strong>
                  <span className="text-muted-foreground">
                    {deployText(t, (at) => new Date(at).toLocaleString()).deploymentDetail(deployment)}
                  </span>
                </span>
                {deployment.message && <span className="truncate">{deployment.message}</span>}
                <span className="flex flex-wrap gap-1">
                  {deployment.url && (
                    <Button size="sm" variant="ghost" onClick={() => open(deployment.url!)}>
                      {t('Open')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={logs?.id === deployment.id}
                    onClick={() =>
                      logs?.id === deployment.id
                        ? setLogs(null)
                        : void run(async () =>
                            setLogs({
                              id: deployment.id,
                              text: await host.invoke('deploy.logs', project.id, deployment.id),
                            }),
                          )
                    }
                  >
                    {t('Logs')}
                  </Button>
                  {canRollBackTo(status, deployment) && (
                    <Button size="sm" variant="ghost" onClick={() => setRollback(deployment)}>
                      {t('Roll back')}
                    </Button>
                  )}
                </span>
                {rollback?.id === deployment.id && (
                  <span className="flex flex-wrap items-center gap-2" role="status">
                    {t('{0} will show this version until the next deploy.', {
                      0: status.productionUrl ?? binding.siteName,
                    })}
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await host.invoke('deploy.rollback', project.id, deployment.id)
                          setRollback(null)
                          load()
                        })
                      }
                    >
                      {t('Roll back')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRollback(null)}>
                      {t('Cancel')}
                    </Button>
                  </span>
                )}
                {logs?.id === deployment.id && (
                  <pre className="m-0 max-h-48 overflow-auto rounded-(--radius-s) bg-fill p-2 text-caption whitespace-pre-wrap">
                    {logs.text || t('No log yet.')}
                  </pre>
                )}
              </li>
            ))}
            {!status.deployments.length && !status.error && (
              <li className="text-caption text-muted-foreground">{t('No deployments yet.')}</li>
            )}
          </ul>
          <UptimeSection projectId={project.id} />
          <UsageSection projectId={project.id} />
          {status.capabilities.includes('domains') && (
            <DomainsSection
              projectId={project.id}
              platform={account ? accountName(t, account.platform, account.name) : binding.platform}
            />
          )}
        </>
      )}
      <ReleaseSection projectId={project.id} />
      <DatabaseSection
        projectId={project.id}
        repoId={repoId}
        onProvisioned={() => setProvisioned((count) => count + 1)}
      />
      <EnvSyncSection key={provisioned} projectId={project.id} repoId={repoId} />
      <CiSetupSection projectId={project.id} repoId={repoId} />
      <LocalAppSection projectId={project.id} repoId={repoId} />
    </Dialog>
  )
}
