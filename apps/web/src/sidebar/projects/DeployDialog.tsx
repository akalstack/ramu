import { useEffect, useState } from 'react'
import { CHECK_STATE } from '@ramu/shared/deployText'
import { DEPLOY_TARGET_PLUGINS } from '@ramu/shared/plugins'
import { DEPLOY_TARGETS } from '@ramu/shared/stacks'
import type { DeployStatus, Project, Repository } from '@ramu/shared/types'
import { BrandIcon } from '@/components/brand-icon'
import { Button } from '@/components/desktop-button'
import { Dialog } from '../../Menu'
import { t, useLanguage } from '../../i18n'
import { invoke as openOnThisComputer } from '../../ipc'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'
import { projectCtx } from '../../workspace/workspace'
import { openPublishRepository } from '../../git/PublishRepositoryHost'
import { usePluginSetup } from '../../customize/pluginSetup'
import { openPluginSettings } from '../../settings/openPluginSettings'
import { CiSetupSection } from './CiSetup'
import { LiveAddressSection } from './LiveAddress'
import { LocalAppSection } from './LocalApp'
import { ProductionDatabaseSection } from './ProductionDatabase'

const open = (url: string) => void openOnThisComputer('app.openExternal', url)

/**
 * Deploy: the project's platform plugin and how far it is set up, the latest deploy as the Git host reports it, the
 * live address the host watches, and the production database migrations run against. Deploys themselves are the
 * project's agent's work through the plugin, so the sheet starts none.
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
  const [status, setStatus] = useState<DeployStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unpublished, setUnpublished] = useState(false)
  const repoId = repos[0]?.id ?? null
  useEffect(() => {
    let live = true
    host.invoke('deploy.status', project.id).then(
      (next) => live && setStatus(next),
      (reason) => live && setError(errorText(reason)),
    )
    return () => {
      live = false
    }
  }, [host, project.id])
  // A repository with no remote has no Git host to report deploys, so the sheet offers to publish it first.
  useEffect(() => {
    if (!repoId) return
    let live = true
    void host.invoke('git.status', projectCtx(project.id), repoId).then(
      (git) => live && setUnpublished(git.remote === false),
      () => {},
    )
    return () => {
      live = false
    }
  }, [host, project.id, repoId])
  const target = status?.recommended ?? null
  const plugin = usePluginSetup(target ? DEPLOY_TARGET_PLUGINS[target] : null)
  const publish = () => {
    const repo = repos[0]
    if (!repo) return
    void openPublishRepository(projectCtx(project.id), repo.id, repo.name).then((published) => {
      if (published) setUnpublished(false)
    })
  }
  const setUp = (work: () => void) => {
    onClose()
    work()
  }

  return (
    <Dialog
      title={t('Deploy {0}', { 0: project.name })}
      confirmLabel={t('Done')}
      cancellable={false}
      error={error}
      onCancel={onClose}
      onConfirm={onClose}
    >
      <section aria-label={t('Set up deploy')} className="flex flex-col gap-2">
        <strong>{t('Set up deploy')}</strong>
        {target ? (
          <p role="status" className="m-0 flex items-start gap-2 text-caption">
            <BrandIcon brand={target} className="mt-0.5" />
            <span>
              {t('{0} suits this project’s stack, through the {1} plugin.', {
                0: DEPLOY_TARGETS[target],
                1: DEPLOY_TARGET_PLUGINS[target].name,
              })}{' '}
              {plugin.state === 'ready'
                ? t(
                    'Ask the project’s agent to deploy: previews run without asking, and production asks you first and runs the migrations before it.',
                  )
                : plugin.state === 'missing'
                  ? t('Install it, then ask the project’s agent to deploy.')
                  : plugin.state === 'credential'
                    ? t('Save its token, then ask the project’s agent to deploy.')
                    : t('Checking…')}
            </span>
          </p>
        ) : (
          <p className="m-0 text-caption text-muted-foreground">
            {t(
              'Install the plugin for the platform you deploy to from Customize → Plugins, then ask the project’s agent to deploy.',
            )}
          </p>
        )}
        {(!target || (plugin.state && plugin.state !== 'ready')) && (
          <span>
            <Button size="sm" variant="secondary" onClick={() => setUp(target ? plugin.setUp : openPluginSettings)}>
              {!target
                ? t('Open plugins')
                : plugin.state === 'missing'
                  ? t('Install the {0} plugin', { 0: DEPLOY_TARGET_PLUGINS[target].name })
                  : t('Open plugin settings')}
            </Button>
          </span>
        )}
      </section>
      <section aria-label={t('Latest deploy')} className="mt-3 flex flex-col gap-2 border-t border-(--line) pt-3">
        <strong>{t('Latest deploy')}</strong>
        {!status ? (
          !error && <p className="m-0 text-caption text-muted-foreground">{t('Checking…')}</p>
        ) : unpublished ? (
          <div className="flex items-center gap-2 text-caption">
            <span className="flex-1 text-muted-foreground">
              {t('This repository is not on a Git host yet. Publish it, then connect the platform to it.')}
            </span>
            <Button variant="outline" size="sm" onClick={publish}>
              {t('Publish to GitHub…')}
            </Button>
          </div>
        ) : !status.repositories.length ? (
          <p className="m-0 text-caption text-muted-foreground">
            {t(
              'Ramu reads each deploy from the checks the Git host lists on the default branch. Connect the platform to the repository, and its deploys show here.',
            )}
          </p>
        ) : (
          status.repositories.map((repository) => (
            <div key={repository.repoId} className="flex flex-col gap-1 text-caption">
              <span className="text-muted-foreground">
                {t('{0} · {1} at {2}', {
                  0: repository.name,
                  1: repository.branch,
                  2: repository.commit.slice(0, 7),
                })}
              </span>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {repository.checks.map((check) => (
                  <li key={check.name} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{check.name}</span>
                    <span className={check.state === 'failure' ? 'text-destructive' : 'text-muted-foreground'}>
                      {t(CHECK_STATE[check.state])}
                    </span>
                    {check.url && (
                      <Button size="sm" variant="ghost" onClick={() => open(check.url!)}>
                        {t('Open')}
                      </Button>
                    )}
                  </li>
                ))}
                {!repository.checks.length && (
                  <li className="text-muted-foreground">{t('No checks on this commit yet.')}</li>
                )}
              </ul>
            </div>
          ))
        )}
      </section>
      <LiveAddressSection projectId={project.id} />
      <ProductionDatabaseSection projectId={project.id} />
      <CiSetupSection projectId={project.id} repoId={repoId} />
      <LocalAppSection projectId={project.id} repoId={repoId} />
    </Dialog>
  )
}
