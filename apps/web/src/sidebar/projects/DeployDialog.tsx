import { useCallback, useEffect, useState } from 'react'
import { canRollBackTo, DEPLOYMENT_STATE, deployText } from '@ramu/shared/deployText'
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
import { RowButton } from '@/components/row-button'
import { Dialog } from '../../Menu'
import { t, useLanguage } from '../../i18n'
import { invoke as openOnThisComputer } from '../../ipc'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'
import { CiSetupSection } from './CiSetup'
import { DatabaseSection } from './Database'
import { DomainsSection } from './Domains'
import { EnvSyncSection } from './EnvSync'
import { ReleaseSection } from './Release'
import { UptimeSection } from './Uptime'
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
  const account = accounts.find((entry) => entry.platform === (binding?.platform ?? platform))
  const canDeploy = !!binding && !!status?.capabilities.includes('deployProduction')
  const recommended = accounts.find((entry) => entry.platform === status?.recommended)
  // An Expo app ships through the stores, not a hosting platform, unless it is already linked to one.
  const storeOnly = !binding && status?.recommended === 'expo'

  const confirm = () => {
    if (storeOnly) return onClose()
    if (!binding) {
      if (!platform || !repoId) return
      void run(async () => {
        setStatus(await host.invoke('deploy.link', project.id, platform, repoId))
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
            : !binding
              ? t('Link repository')
              : !canDeploy
                ? t('Done')
                : confirming
                  ? t('Deploy now')
                  : t('Deploy to production')
      }
      confirmDisabled={!status || (!binding && !storeOnly && (!platform || !repoId || !account?.connected))}
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
            {recommended
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
                <BrandIcon brand={entry.platform} />
                <span className="flex-1 text-foreground">{entry.name}</span>
                <span className="text-caption text-muted-foreground">
                  {entry.connected
                    ? t('Connected as {0}', { 0: entry.account ?? entry.name })
                    : t('Connect it in Settings → Hosting accounts')}
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
          {!repos.length && (
            <p className="text-caption text-muted-foreground">
              {t('Connect a repository to this project and publish it to GitHub first.')}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="flex items-center gap-2">
            <BrandIcon brand={binding.platform} />
            <span className="flex-1">
              {account?.name ?? binding.platform} · {binding.siteName}
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
            <DomainsSection projectId={project.id} platform={account?.name ?? binding.platform} />
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
    </Dialog>
  )
}
