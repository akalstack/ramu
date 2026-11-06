import { useEffect, useState } from 'react'
import type { CiPreview } from '@ramu/shared/ciWorkflow'
import type { Project, Repository } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { RowButton } from '@/components/row-button'
import { Dialog } from '../../Menu'
import { t, useLanguage } from '../../i18n'
import { invoke as openOnThisComputer } from '../../ipc'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'

const STEP: Record<CiPreview['steps'][number]['name'], string> = {
  Lint: 'lint',
  Typecheck: 'typecheck',
  Test: 'test',
  Build: 'build',
}

/** Set up CI for one repository of a project: what the workflow will do, then a pull request that adds it. */
function useCiSetup(projectId: string, repoId: string | null) {
  const host = useHost()
  const [preview, setPreview] = useState<{ repoId: string; value: CiPreview } | null>(null)
  const [problem, setProblem] = useState<{ repoId: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opened, setOpened] = useState<{ url: string | null; path: string } | null>(null)
  useEffect(() => {
    if (!repoId) return
    let current = true
    host.invoke('ci.preview', projectId, repoId).then(
      (value) => current && setPreview({ repoId, value }),
      (reason) => current && setProblem({ repoId, message: errorText(reason) }),
    )
    return () => {
      current = false
    }
  }, [host, projectId, repoId])
  const setUp = async () => {
    if (!repoId) return
    setBusy(true)
    setError(null)
    try {
      setOpened(await host.invoke('ci.setup', projectId, repoId))
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  return {
    preview: preview?.repoId === repoId ? preview.value : null,
    problem: problem?.repoId === repoId ? problem.message : null,
    busy,
    error,
    opened,
    setUp,
  }
}

type CiSetupState = ReturnType<typeof useCiSetup>

function CiSummary({ state }: { state: CiSetupState }) {
  const { preview, problem, opened } = state
  if (opened) {
    const { url } = opened
    return (
      <p className="flex items-center gap-2">
        <span className="flex-1">
          {t('A pull request adds {0}. CI runs on it before you merge.', { 0: opened.path })}
        </span>
        {url && (
          <Button size="sm" variant="secondary" onClick={() => void openOnThisComputer('app.openExternal', url)}>
            {t('Open')}
          </Button>
        )}
      </p>
    )
  }
  if (problem) return <p className="text-caption text-muted-foreground">{problem}</p>
  if (!preview) return <p className="text-caption text-muted-foreground">{t('Checking…')}</p>
  if (preview.exists)
    return (
      <p className="text-caption text-muted-foreground">
        {t('{0} already has {1}.', { 0: preview.defaultBranch, 1: preview.path })}
      </p>
    )
  return (
    <p className="text-caption">
      {preview.steps.length
        ? t('Adds {0} in a pull request. On every pull request and push to {1} it installs with {2}, then runs {3}.', {
            0: preview.path,
            1: preview.defaultBranch,
            2: preview.toolchain,
            3: preview.steps.map((step) => t(STEP[step.name])).join(', '),
          })
        : t(
            'Adds {0} in a pull request. On every pull request and push to {1} it installs with {2}; the project has no lint, test or build script yet.',
            { 0: preview.path, 1: preview.defaultBranch, 2: preview.toolchain },
          )}
    </p>
  )
}

const ready = (state: CiSetupState) => !!state.preview && !state.preview.exists && !state.opened

/** The Deploy sheet's CI row: the same summary and action as the project menu's Set up CI. */
export function CiSetupSection({ projectId, repoId }: { projectId: string; repoId: string | null }) {
  useLanguage()
  const state = useCiSetup(projectId, repoId)
  if (!repoId) return null
  return (
    <section aria-label={t('Checks')} className="mt-3 flex flex-col gap-1 border-t border-(--line) pt-3">
      <strong>{t('Checks')}</strong>
      <CiSummary state={state} />
      {state.error && (
        <p role="alert" className="text-caption text-destructive">
          {state.error}
        </p>
      )}
      {ready(state) && (
        <span>
          <Button size="sm" variant="secondary" disabled={state.busy} onClick={() => void state.setUp()}>
            {state.busy ? t('Working…') : t('Set up CI')}
          </Button>
        </span>
      )}
    </section>
  )
}

export function CiSetupDialog({
  project,
  repos,
  onClose,
}: {
  project: Pick<Project, 'id' | 'name'>
  repos: Repository[]
  onClose: () => void
}) {
  useLanguage()
  const [repoId, setRepoId] = useState<string | null>(repos[0]?.id ?? null)
  const state = useCiSetup(project.id, repoId)
  return (
    <Dialog
      title={t('Set up CI for {0}', { 0: project.name })}
      confirmLabel={state.busy ? t('Working…') : ready(state) ? t('Open pull request') : t('Done')}
      confirmDisabled={!state.preview && !state.problem && !!repoId}
      busy={state.busy}
      error={state.error}
      onCancel={onClose}
      onConfirm={() => (ready(state) ? void state.setUp() : onClose())}
    >
      {repos.length > 1 && !state.opened && (
        <div role="radiogroup" aria-label={t('Repository')} className="mb-3 flex flex-col gap-0.5">
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
      {repoId ? (
        <CiSummary state={state} />
      ) : (
        <p className="text-caption text-muted-foreground">{t('Connect a repository to this project first.')}</p>
      )}
    </Dialog>
  )
}
