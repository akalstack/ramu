import { useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Dialog } from '../../Menu'
import { t, useLanguage } from '../../i18n'
import { errorText } from '../../workspace/TaskPane'
import { useHost } from '../../workspace/HostProvider'

const NAME_PATTERN = /^([A-Za-z0-9-]{1,39}\/)?[A-Za-z0-9._-]{1,100}$/

/** The GitHub name for a folder: letters, digits, dots, dashes and underscores only. */
export const githubNameFor = (folder: string) =>
  folder
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** Publish to GitHub, like VS Code: name and visibility (private by default), then create the repository and push. */
export function PublishRepositoryDialog({
  taskId,
  repoId,
  repoName,
  onDone,
}: {
  taskId: string
  repoId: string
  repoName: string
  onDone: (published: boolean) => void
}) {
  useLanguage()
  const { invoke } = useHost()
  const [name, setName] = useState(githubNameFor(repoName))
  const [isPrivate, setPrivate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const publish = async () => {
    setBusy(true)
    setError(null)
    try {
      await invoke('forge.publishRepository', taskId, repoId, {
        name: name.trim(),
        visibility: isPrivate ? 'private' : 'public',
      })
      window.dispatchEvent(new Event('ramu:git-updated'))
      onDone(true)
    } catch (reason) {
      setError(errorText(reason))
      // The repository may exist now even though the push failed; refresh so Publish branch can finish it.
      window.dispatchEvent(new Event('ramu:git-updated'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={t('Publish to GitHub')}
      confirmLabel={busy ? t('Publishing…') : t('Publish to GitHub')}
      confirmDisabled={!NAME_PATTERN.test(name.trim())}
      busy={busy}
      error={error}
      onCancel={() => onDone(false)}
      onConfirm={() => void publish()}
    >
      <fieldset
        disabled={busy}
        className="grid gap-3 mt-1 border-0 p-0 [&_label]:flex [&_label]:flex-col [&_label]:gap-1.5 [&_label]:text-caption"
      >
        <p className="muted text-muted-foreground small text-caption m-0">
          {t('Creates a GitHub repository with the GitHub CLI, adds it as origin and pushes the current branch.')}
        </p>
        <label>
          {t('Repository name')}
          <Input autoFocus value={name} maxLength={140} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="flex-row! items-center">
          <Checkbox checked={isPrivate} onCheckedChange={(checked) => setPrivate(checked === true)} />
          {t('Private repository')}
        </label>
      </fieldset>
    </Dialog>
  )
}
