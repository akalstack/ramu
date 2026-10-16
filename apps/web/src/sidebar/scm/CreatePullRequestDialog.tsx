import { useEffect, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { PullRequestInput } from '@ramu/shared/types'
import { Dialog } from '../../Menu'
import { t, useLanguage } from '../../i18n'
import { invoke } from '../../ipc'
import { errorText } from '../../workspace/TaskPane'

const FIELDS =
  'grid gap-3 mt-1 [&_label]:flex [&_label]:flex-col [&_label]:gap-1.5 [&_label]:text-caption [&_textarea]:resize-y [&_textarea]:leading-[1.5]'

/**
 * Title and description drafted from the branch's commits (closing the issue its chat started from),
 * editable before anything is pushed. Confirming publishes the branch if needed and opens the pull request.
 */
export function CreatePullRequestDialog({
  taskId,
  repoId,
  onDone,
}: {
  taskId: string
  repoId: string
  onDone: (created: boolean) => void
}) {
  useLanguage()
  const [input, setInput] = useState<PullRequestInput | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    invoke('forge.pullRequestDraft', taskId, repoId).then(
      (draft) => {
        if (!cancelled)
          setInput({
            title: draft.title,
            body: draft.body,
            base: draft.base,
            draft: false,
            ...(draft.branch ? { branch: draft.branch } : {}),
          })
      },
      (reason) => {
        if (!cancelled) setError(errorText(reason))
      },
    )
    return () => {
      cancelled = true
    }
  }, [taskId, repoId])

  const create = async () => {
    if (!input) return
    setBusy(true)
    setError(null)
    try {
      await invoke('forge.createPullRequest', taskId, repoId, input)
      window.dispatchEvent(new Event('ramu:git-updated'))
      onDone(true)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={t('Create pull request')}
      confirmLabel={busy ? t('Creating…') : t('Create pull request')}
      confirmDisabled={!input?.title.trim() || (input.branch !== undefined && !input.branch.trim())}
      busy={busy}
      error={error}
      onCancel={() => onDone(false)}
      onConfirm={() => void create()}
    >
      {input ? (
        <fieldset disabled={busy} className={`${FIELDS} border-0 p-0`}>
          <p className="muted text-muted-foreground small text-caption m-0">
            {input.branch !== undefined
              ? t('Into {0}. Your commits move to a new branch, which is published first. {0} itself is not changed.', {
                  '0': input.base,
                })
              : t('Into {0}. The branch is published first if it is not on the remote yet.', { '0': input.base })}
          </p>
          {input.branch !== undefined && (
            <label>
              {t('New branch')}
              <Input
                value={input.branch}
                maxLength={200}
                onChange={(event) => setInput({ ...input, branch: event.target.value })}
              />
            </label>
          )}
          <label>
            {t('Title')}
            <Input
              autoFocus
              value={input.title}
              maxLength={500}
              onChange={(event) => setInput({ ...input, title: event.target.value })}
            />
          </label>
          <label>
            {t('Description')}
            <Textarea
              rows={8}
              value={input.body}
              maxLength={100_000}
              onChange={(event) => setInput({ ...input, body: event.target.value })}
            />
          </label>
          <label className="flex-row! items-center">
            <Checkbox
              checked={input.draft}
              onCheckedChange={(checked) => setInput({ ...input, draft: checked === true })}
            />
            {t('Open as draft')}
          </label>
        </fieldset>
      ) : (
        !error && <p className="muted text-muted-foreground">{t('Drafting from your commits…')}</p>
      )}
    </Dialog>
  )
}
