import { ButtonGroup } from '@/components/ui/button-group'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/desktop-button'
import { Check, ChevronDown, Sparkles } from 'lucide-react'
import type { CommitAction, CommitDraft, GitStatus } from '@ramu/shared/types'
import { t } from '../../i18n'
import { useAppSettings } from '../../settings/AppSettings'
import { SyncButton } from '../../git/GitControls'
import { providerName } from '../../chat/AgentControls'
import { Menu } from '../../Menu'
import { errorText } from '../../workspace/TaskPane'
import { formatKeys } from '../../commands'
import { ICON_BUTTON } from './classes'
import { commitActionLabel } from './helpers'
import type { CommitFn } from './useCommitFlow'

/** Commit message field, AI drafting and the Commit / Sync button. */
export function CommitBox({
  canCreatePr,
  repoName,
  status,
  stagedCount,
  unstagedCount,
  conflictCount,
  loading,
  busy,
  generating,
  message,
  draft,
  onMessage,
  onDraft,
  onGenerate,
  commit,
  onSync,
  reportError,
}: {
  /** GitHub with a signed-in `gh`: the only host that can open pull requests today. */
  canCreatePr: boolean
  repoName: string
  status: GitStatus | null
  stagedCount: number
  unstagedCount: number
  conflictCount: number
  loading: boolean
  busy: boolean
  generating: boolean
  message: string
  draft: CommitDraft | null
  onMessage: (message: string) => void
  onDraft: (draft: CommitDraft | null) => void
  onGenerate: () => void
  commit: CommitFn
  onSync: () => void
  reportError: (message: string) => void
}) {
  const { preferences, save: savePreferences } = useAppSettings()
  const canCommit = !loading && !busy && !generating && !!(stagedCount || unstagedCount) && !conflictCount
  const commitAction = preferences.defaultCommitAction
  const commitLabel = commitActionLabel(commitAction)
  const canRunCommit = (action: CommitAction) =>
    canCommit && (action === 'commit' || (!!status?.branch && !!status.remote && !status.operation))
  const requestCommit = (action: CommitAction = commitAction) => {
    if (!canRunCommit(action)) return
    // Nothing staged: the commit takes every change (see useCommitFlow).
    void commit(action).catch((reason) => reportError(errorText(reason)))
  }
  const selectCommitAction = (action: CommitAction) => {
    void (async () => {
      if (action !== preferences.defaultCommitAction)
        await savePreferences({ ...preferences, defaultCommitAction: action })
      requestCommit(action)
    })().catch((reason) => reportError(errorText(reason)))
  }
  const canAmend = !loading && !busy && !generating && !!status?.oid && !status.operation && !conflictCount
  const canPickRemoteAction = !!status?.branch && !!status.remote && !status.operation
  // Like VS Code: with a clean tree and something to sync, the primary button becomes Sync Changes (or Publish Branch) instead of Commit.
  const syncOnly =
    !!status &&
    !status.entries.length &&
    !status.operation &&
    !!status.branch &&
    !!status.remote &&
    (!status.upstream || status.ahead > 0 || status.behind > 0)
  return (
    <>
      <div className="commit-input-wrap relative m-[4px_0_8px]">
        <Textarea
          className="commit-msg min-h-[56px] resize-y"
          rows={2}
          maxLength={100000}
          value={message}
          placeholder={t('Message (empty drafts one with AI)')}
          aria-label={t('Commit message for {0}', { '0': repoName })}
          onChange={(e) => {
            onMessage(e.target.value)
            if (!e.target.value.trim()) onDraft(null)
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canCommit) requestCommit()
          }}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          className={`${ICON_BUTTON} commit-ai absolute right-1.5 top-1.5`}
          title={
            stagedCount ? t('Draft a commit message from staged changes') : t('Draft a commit message from all changes')
          }
          aria-label={t('AI commit message for {0}', { '0': repoName })}
          disabled={busy || generating || !(stagedCount || unstagedCount) || !!conflictCount}
          onClick={onGenerate}
        >
          <Sparkles
            size={14}
            className={
              generating
                ? 'shimmer text-control [background:linear-gradient(90deg,_var(--muted)_30%,_var(--text)_50%,_var(--muted)_70%)] [background-size:200%_100%] [-webkit-background-clip:text] [background-clip:text] [color:transparent] [animation:shimmer_1.8s_linear_infinite]'
                : ''
            }
          />
        </Button>
      </div>
      {!syncOnly && (
        <ButtonGroup
          className="scm-commit-split [&_>_button.scm-commit]:flex-1 [&_>_button.scm-commit]:w-auto [&_>_button.scm-commit]:min-w-0 [&_>_button.scm-commit]:m-0 [&_>_button.scm-commit]:[border-radius:var(--radius-s)_0_0_var(--radius-s)] flex gap-0 mb-1.5"
          aria-label={t('Commit')}
        >
          <Button
            variant="default"
            size="sm"
            className="scm-commit primary bg-primary! text-primary-foreground! border-transparent font-semibold hover:bg-primary-hover! disabled:opacity-50"
            aria-label={commitLabel}
            disabled={!canRunCommit(commitAction)}
            title={
              !canRunCommit(commitAction)
                ? loading
                  ? t('Loading changes…')
                  : conflictCount
                    ? t('Resolve the conflicts first')
                    : !stagedCount && !unstagedCount
                      ? t('There is nothing to commit.')
                      : commitAction !== 'commit' && !(status?.branch && status.remote)
                        ? t('This repository has no branch with a remote.')
                        : status?.operation
                          ? t('Finish the {0} in progress first', { '0': status.operation })
                          : undefined
                : stagedCount
                  ? t('Commits the {0} staged files', { '0': stagedCount })
                  : t('Nothing is staged, so every change is committed')
            }
            onClick={() => requestCommit()}
          >
            <Check size={14} />
            {generating ? t('Drafting message…') : busy ? t('Working…') : commitLabel}
            {!generating && !busy && !stagedCount && unstagedCount > 0 && (
              <span className="font-normal opacity-80">{t('all {0}', { '0': unstagedCount })}</span>
            )}
          </Button>
          <Menu
            disabled={!canRunCommit(commitAction)}
            label={t('Commit options')}
            icon={<ChevronDown size={14} />}
            className="scm-commit-menu bg-primary! text-primary-foreground! border-transparent border-l border-l-primary-foreground/25 hover:bg-primary-hover! aria-expanded:bg-primary-hover! disabled:opacity-50"
            align="end"
            items={[
              {
                key: 'commit',
                label: t('Commit'),
                selected: commitAction === 'commit',
                onSelect: () => selectCommitAction('commit'),
              },
              {
                key: 'new-branch',
                label: t('Commit on new branch'),
                disabled: !canCommit || !!status?.operation,
                onSelect: () => void commit('new-branch').catch((reason) => reportError(errorText(reason))),
              },
              ...(canCreatePr
                ? [
                    {
                      key: 'pull-request',
                      label: t('Commit, Push & PR'),
                      title: t(
                        'Commit, push, then open a pull request. On the default branch the commit moves to a new branch.',
                      ),
                      disabled: !canPickRemoteAction || !canCommit,
                      onSelect: () =>
                        void commit('push', undefined, true, true).catch((reason) => reportError(errorText(reason))),
                    },
                  ]
                : []),
              {
                key: 'amend',
                label: t('Commit (Amend)'),
                title: t('Replace the latest commit; leave the message empty to keep its message'),
                disabled: !canAmend,
                onSelect: () => void commit('amend'),
              },
              { key: 'separator', separator: true },
              {
                key: 'push',
                label: t('Commit & Push'),
                selected: commitAction === 'push',
                title: t('Shortcut: {0}', { '0': formatKeys('mod+alt+p') }),
                disabled: !canPickRemoteAction,
                onSelect: () => selectCommitAction('push'),
              },
              {
                key: 'sync',
                label: t('Commit & Sync'),
                selected: commitAction === 'sync',
                disabled: !canPickRemoteAction,
                onSelect: () => selectCommitAction('sync'),
              },
            ]}
          />
        </ButtonGroup>
      )}
      {syncOnly && (
        <SyncButton
          status={status}
          busy={busy}
          pullMode={preferences.pullMode}
          className="scm-commit primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover mb-1.5"
          showLabel
          onSync={onSync}
        />
      )}
      {draft && (
        <div className="muted text-muted-foreground small text-caption ai-draft-label p-[3px_0] text-caption">
          {t('Drafted with ')}
          {providerName(draft.provider)} {t(' · Review before committing.')}
        </div>
      )}
    </>
  )
}
