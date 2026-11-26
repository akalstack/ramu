import { useState } from 'react'
import type { ArtifactInfo } from '@ramu/shared/artifacts'
import { PROJECT_NAME } from '@ramu/shared/stacks'
import { isProjectFolder, titleFolderName } from '@ramu/shared/workspace/hostFolders'
import { ChoiceChip, ChoiceChips } from '@/components/choice-group'
import { Checkbox } from '@/components/desktop-checkbox'
import { Input } from '../components/desktop-input'
import { Dialog } from '../Menu'
import { Combobox } from '@/components/combobox'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { useWorkspace } from '../workspace/workspace'
import { ProjectParentField, useProjectParent } from '../workspace/ProjectParentField'
import { errorText } from '../workspace/TaskPane'

/**
 * Make it a project: the artifact's sources and records go into a folder of one of the host's projects (the artifact's
 * own project first), or into a new project folder wherever the person puts it. A thread then builds it into an app.
 */
export function MakeProjectDialog({
  page,
  onClose,
  onExported,
}: {
  page: ArtifactInfo
  onClose(): void
  /** Called with what happened when the files went into a project and no thread started. */
  onExported(status: string): void
}) {
  useLanguage()
  const { invoke, id: host } = useHost()
  const ws = useWorkspace()
  const projects = ws.projects.filter((project) => project.root || ws.repos[project.id]?.length)
  const own = projects.some((project) => project.id === page.projectId) ? page.projectId : null
  const [mode, setMode] = useState<'project' | 'new'>(own ? 'project' : 'new')
  const [projectId, setProjectId] = useState(own ?? projects[0]?.id ?? '')
  const [name, setName] = useState(() => titleFolderName(page.title))
  const [startThread, setStartThread] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const location = useProjectParent(host)
  const folder = name.trim()
  const valid = mode === 'project' ? !!projectId && isProjectFolder(folder) : PROJECT_NAME.test(folder)
  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const made = await invoke(
        'artifacts.makeProject',
        page.id,
        mode === 'project'
          ? { kind: 'project', projectId, folder, startThread }
          : { kind: 'new', name: folder, ...(location.chosen ? { parent: location.chosen } : {}) },
      )
      await ws.refresh()
      onClose()
      if (made.thread) ws.openTask(made.thread.taskId)
      else onExported(t('Exported to {0}', { '0': made.folder }))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={t('Make it a project?')}
      confirmLabel={mode === 'project' && !startThread ? t('Export') : t('Make it a project')}
      confirmDisabled={!valid}
      busy={busy}
      error={error}
      onCancel={onClose}
      onConfirm={() => void confirm()}
    >
      <p>
        {page.capabilities.records || page.capabilities.ai
          ? t(
              'This artifact keeps records or uses a model on this host, so it cannot go on the web as is. A project can have its own database and server.',
            )
          : t('A project can have a backend, more files, sign-in and its own domain.')}
      </p>
      <ChoiceChips
        size="sm"
        className="my-3"
        aria-label={t('Where it goes')}
        value={[mode]}
        onValueChange={(values) => values[0] && setMode(values[0] as 'project' | 'new')}
      >
        <ChoiceChip value="project" className="px-2.5" disabled={!projects.length}>
          {t('Into a project')}
        </ChoiceChip>
        <ChoiceChip value="new" className="px-2.5">
          {t('New project')}
        </ChoiceChip>
      </ChoiceChips>
      <div className="flex flex-col gap-2">
        {mode === 'project' && (
          <Combobox
            label={t('Project')}
            value={projectId}
            searchPlaceholder={t('Search projects…')}
            options={projects.map((project) => ({ value: project.id, label: project.name }))}
            onChange={setProjectId}
          />
        )}
        <Input
          value={name}
          maxLength={mode === 'project' ? 400 : 100}
          spellCheck={false}
          autoCapitalize="off"
          aria-label={mode === 'project' ? t('Folder in the project') : t('Project name')}
          placeholder={mode === 'project' ? t('Folder in the project') : t('Project name')}
          aria-invalid={!!folder && !valid}
          onChange={(event) => setName(event.target.value)}
        />
        {mode === 'new' && <ProjectParentField location={location} disabled={busy} />}
        {mode === 'project' && (
          <label className="flex items-center gap-2 text-caption text-muted-foreground cursor-default">
            <Checkbox checked={startThread} onCheckedChange={(checked) => setStartThread(checked === true)} />
            {t('Start a thread there to build it into the project')}
          </label>
        )}
        <p className="m-0 text-caption text-muted-foreground">
          {mode === 'project'
            ? t(
                'Ramu writes the artifact’s sources and records to this folder in the project. A folder that already holds files is kept, and a numbered one is used instead.',
              )
            : t(
                'Ramu writes the artifact’s sources and records to a new folder, adds it to your projects and starts a thread there to turn it into an app.',
              )}
        </p>
      </div>
    </Dialog>
  )
}
