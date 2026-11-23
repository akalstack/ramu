import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { switchBranch } from '../../git/SwitchBranchDialog'
import { ContentSkeleton } from '@/components/content-skeleton'
import { Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { GitCommit, GitStatusEntry, RepositoryBinding } from '@ramu/shared/types'
import { t, useLanguage } from '../../i18n'
import { notifyError } from '../../chat/Notifications'
import { useGitBusy } from '../../git/gitBusy'
import { ChangeRow } from './ChangeRow'
import { REPO_SECTION } from './classes'
import { CommitBox } from './CommitBox'
import { ConfirmationDialog } from './ConfirmationDialog'
import { RemoteChoiceDialog } from './RemoteChoiceDialog'
import { CHOICE_LABEL, ConflictList } from './ConflictList'
import type { ConflictChoice } from '@ramu/shared/conflicts'
import { Dialog } from '../../Menu'
import { GitInspector } from './GitInspector'
import { OperationBanner } from './OperationBanner'
import { PullRequestSection } from './PullRequestSection'
import { openPublishRepository } from '../../git/PublishRepositoryHost'
import { usePullRequestSupport } from '../../git/usePullRequestSupport'
import { ChangeGroupHeader } from './parts'
import { RepoActionsMenu } from './RepoActionsMenu'
import { RepoHeader } from './RepoHeader'
import type { GitTab } from './types'
import { useAgentSettings } from './useAgentSettings'
import { useCommitFlow } from './useCommitFlow'
import { useCommitShortcut } from './useCommitShortcut'
import { useConfirmation } from './useConfirmation'
import { useFileContextMenu } from './useFileContextMenu'
import { useGitActions } from './useGitActions'
import { useRepositoryData } from './useRepositoryData'
import { useResolveWithAi } from './useResolveWithAi'
import { useHost } from '../../workspace/HostProvider'

/** Source Control for one repository: changes, commit box and operation state, plus its Git section. */
const ALL_TITLE: Record<ConflictChoice, string> = {
  current: 'Keep the current side in every conflicted file?',
  incoming: 'Keep the incoming side in every conflicted file?',
  both: 'Keep both sides in every conflicted file?',
}

export function RepositoryControl({
  taskId,
  binding,
  compact = false,
  collapsed = false,
  gitHost = null,
  showGit = true,
  gitRepos = [],
  onGitRepo,
  onToggle,
  onGitCollapsed,
}: {
  taskId: string
  binding: RepositoryBinding
  compact?: boolean
  collapsed?: boolean
  gitHost?: HTMLElement | null
  showGit?: boolean
  gitRepos?: RepositoryBinding[]
  onGitRepo?: (repoId: string) => void
  onToggle?: () => void
  onGitCollapsed?: (collapsed: boolean) => void
}) {
  useLanguage()
  const { invoke } = useHost()
  const reportError = useCallback(
    (message: string) => notifyError(message, `Git · ${binding.repoName}`),
    [binding.repoName],
  )
  const { status, loading, commits, stashes, branches, load } = useRepositoryData(taskId, binding, reportError)
  const canCreatePr = usePullRequestSupport(taskId, binding.repoId, status?.branch ?? null, status?.remote)
  // Shared per repository, so work started from the status bar, commands or the shortcut also disables this panel.
  const busy = useGitBusy(taskId, binding.repoId)
  const [settings] = useAgentSettings(taskId)
  const [historyOpen, setHistoryOpen] = useState(true)
  const [stagedOpen, setStagedOpen] = useState(true)
  const [changesOpen, setChangesOpen] = useState(true)
  const [gitTab, setGitTab] = useState<GitTab>('commits')
  const [acceptAll, setAcceptAll] = useState<ConflictChoice | null>(null)
  useEffect(() => {
    if (showGit) onGitCollapsed?.(!historyOpen)
  }, [showGit, historyOpen, onGitCollapsed])

  const actions = useGitActions({ taskId, binding, load, reportError })
  const { stagePaths, fetchRepo, sync, popStash, applyStash } = actions
  const staged = status?.entries.filter((e) => e.staged && e.staged !== 'unmerged') ?? []
  const conflicts = status?.entries.filter((e) => e.staged === 'unmerged') ?? []
  const unstaged = status?.entries.filter((e) => e.unstaged && e.unstaged !== 'unmerged') ?? []
  const changes = unstaged
  const canStash = !!status?.oid && !!status.entries.length && !conflicts.length && !status.operation
  const { resolving, resolveWithAi } = useResolveWithAi({
    taskId,
    binding,
    status,
    conflicts,
    settings,
    requireSaved: actions.requireSaved,
    reportError,
  })
  const flow = useCommitFlow({
    taskId,
    binding,
    settings,
    status,
    conflictCount: conflicts.length,
    loading,
    busy,
    run: actions.run,
    requireSaved: actions.requireSaved,
    reportError,
  })
  const dialog = useConfirmation({
    taskId,
    repoId: binding.repoId,
    busy,
    run: actions.run,
    requireSaved: actions.requireSaved,
    onUndone: (message) => {
      flow.setMessage(message)
      flow.setDraft(null)
    },
  })
  const { request: requestConfirmation, ask } = dialog
  const canUndo =
    !busy &&
    !flow.generating &&
    !!status?.oid &&
    commits.length > 1 &&
    !status.detached &&
    !status.operation &&
    !conflicts.length &&
    !(status.upstream && status.ahead === 0)
  const requestUndo = (commit: GitCommit) =>
    requestConfirmation({ kind: 'undo', oid: commit.oid, title: commit.subject })
  const requestDiscard = (paths: string[]) => requestConfirmation({ kind: 'discard', paths })
  const root = useCommitShortcut({
    taskId,
    repoId: binding.repoId,
    staged: staged.length,
    unstaged: unstaged.map((entry) => entry.path),
    publishable: !!status?.branch && !!status.remote && !status.operation && !conflicts.length,
    commit: flow.commit,
    reportError,
  })
  const fileContext = useFileContextMenu({
    taskId,
    repoId: binding.repoId,
    busy,
    stagePaths,
    onDiscard: requestDiscard,
    reportError,
  })
  const row = (e: GitStatusEntry, isStaged: boolean) => (
    <ChangeRow
      key={`${isStaged}:${e.path}`}
      taskId={taskId}
      repoId={binding.repoId}
      entry={e}
      staged={isStaged}
      busy={busy}
      contextMenu={fileContext.contextMenu}
      onContextEntry={fileContext.selectEntry}
      onToggleStage={() => stagePaths([e.path], !isStaged)}
      onDiscard={() => requestDiscard([e.path])}
    />
  )
  // In a multi-repository list the Git section is portalled into the single pinned slot; nothing renders until that slot mounts.
  const inGitSlot = (node: ReactNode) => (compact ? gitHost && createPortal(node, gitHost) : node)
  const Content = compact ? 'div' : OverlayScrollArea
  return (
    <div ref={root} className={`scm-repo-body${compact ? ' compact' : ''}${collapsed ? ' collapsed' : ''}`}>
      {fileContext.contextMenu.menu}
      {acceptAll && (
        <Dialog
          title={t(ALL_TITLE[acceptAll])}
          confirmLabel={t(CHOICE_LABEL[acceptAll])}
          onConfirm={() => {
            const choice = acceptAll
            setAcceptAll(null)
            void actions.run(async () => {
              actions.requireSaved()
              const result = await invoke('git.resolveAllConflicts', taskId, binding.repoId, choice)
              if (result.skipped.length)
                reportError(result.skipped.map((entry) => `${entry.path}: ${entry.error}`).join('\n'))
            })
          }}
          onCancel={() => setAcceptAll(null)}
        >
          <p className="m-0">
            {t(
              'Every conflict in {0} files is replaced by that side, and each file is staged. Changes Git merged cleanly stay.',
              { '0': String(conflicts.length) },
            )}
          </p>
        </Dialog>
      )}
      {actions.remoteChoices && (
        <RemoteChoiceDialog
          branch={status?.branch ?? null}
          remotes={actions.remoteChoices}
          busy={busy}
          onCancel={actions.cancelRemoteChoice}
          onChoose={actions.pushTo}
        />
      )}
      {dialog.confirmation && (
        <ConfirmationDialog
          confirmation={dialog.confirmation}
          busy={busy}
          operationName={dialog.operationName}
          onOperationName={dialog.setOperationName}
          onCancel={dialog.cancel}
          onConfirm={dialog.confirm}
        />
      )}
      <Content className="scm-content [.scm-repo-body.compact_&]:flex-none flex-1 min-w-0 min-h-0">
        <section className={REPO_SECTION}>
          <RepoHeader
            repoName={binding.repoName}
            collapsed={collapsed}
            entryCount={status?.entries.length ?? 0}
            busy={busy}
            canStash={canStash}
            onToggle={onToggle}
            onStash={() => ask({ kind: 'stash' })}
            onRefresh={() => void load()}
          >
            <RepoActionsMenu
              taskId={taskId}
              repoId={binding.repoId}
              status={status}
              staged={staged}
              unstaged={unstaged}
              branches={branches}
              stashes={stashes}
              commits={commits}
              disabled={loading || busy || flow.generating}
              canStash={canStash}
              canUndo={canUndo}
              actions={actions}
              onRequest={requestConfirmation}
              onAsk={ask}
            />
          </RepoHeader>
          {status?.operation && (
            <OperationBanner
              operation={status.operation}
              conflictCount={conflicts.length}
              busy={busy}
              resolving={resolving}
              onResolveWithAi={() => void resolveWithAi()}
              onContinue={() => void actions.run(() => invoke('git.continueOperation', taskId, binding.repoId))}
              onAbort={() => void actions.run(() => invoke('git.abortOperation', taskId, binding.repoId))}
            />
          )}
          <CommitBox
            canCreatePr={canCreatePr}
            repoName={binding.repoName}
            status={status}
            stagedCount={staged.length}
            unstagedCount={unstaged.length}
            conflictCount={conflicts.length}
            loading={loading}
            busy={busy}
            generating={flow.generating}
            message={flow.message}
            draft={flow.draft}
            onMessage={flow.setMessage}
            onDraft={flow.setDraft}
            onGenerate={flow.generate}
            commit={flow.commit}
            onSync={sync}
            onPublishRepository={() => void openPublishRepository(taskId, binding.repoId, binding.repoName)}
            reportError={reportError}
          />
          <PullRequestSection
            taskId={taskId}
            binding={binding}
            status={status}
            busy={busy}
            settings={settings}
            reportError={reportError}
          />
          {loading && <ContentSkeleton />}
          {!!conflicts.length && (
            <ConflictList
              taskId={taskId}
              repoId={binding.repoId}
              conflicts={conflicts}
              canResolveWithAi={!status?.operation}
              busy={busy}
              resolving={resolving}
              onResolveWithAi={(paths) => void resolveWithAi(paths)}
              onChoose={(path, choice) =>
                path
                  ? void actions.run(async () => {
                      actions.requireSaved()
                      await invoke('git.resolveConflict', taskId, binding.repoId, path, choice)
                    })
                  : setAcceptAll(choice)
              }
              onMarkResolved={(path) => stagePaths([path], true)}
            />
          )}
          {!!staged.length && (
            <>
              <ChangeGroupHeader
                label={t('Staged')}
                open={stagedOpen}
                count={staged.length}
                actionLabel={t('Unstage all')}
                actionIcon={<Minus size={13} />}
                busy={busy}
                onToggle={() => setStagedOpen((open) => !open)}
                onAction={() =>
                  stagePaths(
                    staged.map((e) => e.path),
                    false,
                  )
                }
              />
              {stagedOpen && staged.map((e) => row(e, true))}
            </>
          )}
          <ChangeGroupHeader
            label={t('Changes')}
            open={changesOpen}
            count={changes.length}
            actionLabel={t('Stage all')}
            actionIcon={<Plus size={13} />}
            busy={busy}
            onToggle={() => setChangesOpen((open) => !open)}
            onAction={() =>
              stagePaths(
                unstaged.map((e) => e.path),
                true,
              )
            }
          />
          {changesOpen && changes.map((e) => row(e, false))}
          {!status?.entries.length && status && (
            <p className="muted text-muted-foreground small text-caption scm-empty p-[8px_0]">
              {t('No changes in this checkout.')}
            </p>
          )}
        </section>
      </Content>
      {showGit &&
        inGitSlot(
          <GitInspector
            taskId={taskId}
            binding={binding}
            status={status}
            branches={branches}
            commits={commits}
            stashes={stashes}
            loading={loading}
            busy={busy}
            canStash={canStash}
            canUndo={canUndo}
            open={historyOpen}
            tab={gitTab}
            switchableRepos={gitHost && gitRepos.length > 1 ? gitRepos : []}
            onOpen={setHistoryOpen}
            onTab={setGitTab}
            onRepo={(repoId) => onGitRepo?.(repoId)}
            onFetch={fetchRepo}
            onSync={sync}
            onCheckout={(branch) =>
              void actions.run(async () => {
                actions.requireSaved()
                await switchBranch(invoke, taskId, binding.repoId, branch)
              })
            }
            onUndo={requestUndo}
            onApplyStash={(stash) => void applyStash(stash)}
            onPopStash={(stash) => void popStash(stash)}
            onDropStash={(stash) => requestConfirmation({ kind: 'drop-stash', oid: stash.oid, title: stash.subject })}
            onStash={() => ask({ kind: 'stash' })}
          />,
        )}
    </div>
  )
}
