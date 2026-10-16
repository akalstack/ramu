import { ArrowDown, ArrowUp, CloudDownload, MoreHorizontal } from 'lucide-react'
import type { GitBranchInfo, GitCommit, GitStash, GitStatus, GitStatusEntry } from '@ramu/shared/types'
import { t } from '../../i18n'
import { useAppSettings } from '../../settings/AppSettings'
import { Menu } from '../../Menu'
import { useWorkspace } from '../../workspace/workspace'
import { ICON_BUTTON } from './classes'
import { PULL_NAME } from './constants'
import type { Confirmation } from './types'
import type { GitActions } from './useGitActions'

/** The "Source control actions" overflow menu of a repository header. */
export function RepoActionsMenu({
  taskId,
  repoId,
  status,
  staged,
  unstaged,
  branches,
  stashes,
  commits,
  disabled,
  canStash,
  canUndo,
  actions,
  onRequest,
  onAsk,
}: {
  taskId: string
  repoId: string
  status: GitStatus | null
  staged: GitStatusEntry[]
  unstaged: GitStatusEntry[]
  branches: GitBranchInfo[]
  stashes: GitStash[]
  commits: GitCommit[]
  disabled: boolean
  canStash: boolean
  canUndo: boolean
  actions: GitActions
  onRequest: (confirmation: Confirmation) => void
  /** Like `onRequest`, for confirmations that first ask for a name. */
  onAsk: (confirmation: Confirmation, initial?: string) => void
}) {
  const ws = useWorkspace()
  const { preferences } = useAppSettings()
  const { stagePaths, popStash, applyStash, sync, pull, pushRepo, fetchRepo } = actions
  const others = branches.filter((branch) => !branch.current)
  const deletable = others.filter((branch) => !branch.worktree)
  return (
    <Menu
      disabled={disabled}
      label={t('Source control actions')}
      icon={<MoreHorizontal size={14} />}
      className={ICON_BUTTON}
      align="end"
      items={[
        {
          key: 'pull',
          label: (
            <>
              <ArrowDown size={14} />
              {t('Pull')}
            </>
          ),
          disabled: !!status?.operation,
          onSelect: () => pull(),
        },
        {
          key: 'push',
          label: (
            <>
              <ArrowUp size={14} />
              {status?.upstream ? t('Push') : t('Publish branch')}
            </>
          ),
          disabled: !!status?.operation,
          onSelect: pushRepo,
        },
        {
          key: 'fetch',
          label: (
            <>
              <CloudDownload size={14} />
              {t('Fetch')}
            </>
          ),
          onSelect: fetchRepo,
        },
        { key: 'groups-sep', separator: true },
        {
          key: 'changes',
          label: t('Changes'),
          submenu: [
            {
              key: 'stage-all',
              label: t('Stage all changes'),
              disabled: !unstaged.length,
              onSelect: () =>
                stagePaths(
                  unstaged.map((entry) => entry.path),
                  true,
                ),
            },
            {
              key: 'unstage-all',
              label: t('Unstage all changes'),
              disabled: !staged.length,
              onSelect: () =>
                stagePaths(
                  staged.map((entry) => entry.path),
                  false,
                ),
            },
            {
              key: 'discard-all',
              label: t('Discard all unstaged changes…'),
              danger: true,
              disabled: !unstaged.length,
              onSelect: () => onRequest({ kind: 'discard', paths: unstaged.map((entry) => entry.path) }),
            },
            { key: 'changes-sep', separator: true },
            {
              key: 'open-all',
              label: t('Open all changes'),
              disabled: !status?.entries.length,
              onSelect: () =>
                status?.entries
                  .filter((entry) => entry.staged !== 'unmerged')
                  .forEach((entry) =>
                    ws.openView(taskId, {
                      kind: 'diff',
                      repoId,
                      path: entry.path,
                      staged: !!entry.staged && !entry.unstaged,
                      preview: false,
                    }),
                  ),
            },
            {
              key: 'undo-commit',
              label: t('Undo last commit…'),
              disabled: !canUndo,
              onSelect: () => {
                const head = commits.find((commit) => commit.oid === status?.oid)
                if (head) onRequest({ kind: 'undo', oid: head.oid, title: head.subject })
              },
            },
          ],
        },
        {
          key: 'pull-push',
          label: t('Pull, Push'),
          submenu: [
            {
              key: 'sync',
              label: status?.upstream ? t('Sync changes') : t('Publish branch'),
              disabled: !status?.branch || !!status.operation,
              onSelect: sync,
            },
            {
              key: 'pull-default',
              label: t('Pull ({0})', { '0': PULL_NAME[preferences.pullMode] }),
              disabled: !!status?.operation,
              onSelect: () => pull(),
            },
            ...(['rebase', 'merge', 'ff-only'] as const)
              .filter((mode) => mode !== preferences.pullMode)
              .map((mode) => ({
                key: `pull-${mode}`,
                label: t('Pull ({0})', { '0': PULL_NAME[mode] }),
                disabled: !!status?.operation,
                onSelect: () => pull(mode),
              })),
          ],
        },
        {
          key: 'branch',
          label: t('Branch'),
          submenu: [
            {
              key: 'merge',
              label: t('Merge…'),
              disabled: !others.length || !!status?.operation,
              submenu: others.map((branch) => ({
                key: branch.name,
                label: branch.name,
                onSelect: () => onRequest({ kind: 'merge', name: branch.name }),
              })),
            },
            { key: 'merge-sep', separator: true },
            {
              key: 'create-branch',
              label: t('Create branch…'),
              onSelect: () => onAsk({ kind: 'branch' }),
            },
            {
              key: 'create-branch-from',
              label: t('Create branch from…'),
              disabled: !branches.length,
              submenu: branches.map((branch) => ({
                key: branch.name,
                label: branch.name,
                onSelect: () => onAsk({ kind: 'branch-from', from: branch.name }),
              })),
            },
            { key: 'rename-sep', separator: true },
            {
              key: 'rename-branch',
              label: t('Rename branch…'),
              disabled: !status?.branch,
              onSelect: () => onAsk({ kind: 'rename-branch' }, status?.branch ?? ''),
            },
            {
              key: 'delete-branch',
              label: t('Delete branch…'),
              disabled: !deletable.length,
              submenu: deletable.map((branch) => ({
                key: branch.name,
                label: branch.name,
                onSelect: () => onRequest({ kind: 'delete-branch', name: branch.name }),
              })),
            },
            ...(status?.branch && !status.upstream && status.remote
              ? [
                  { key: 'publish-sep', separator: true as const },
                  { key: 'publish', label: t('Publish branch'), disabled: !!status.operation, onSelect: pushRepo },
                ]
              : []),
          ],
        },
        {
          key: 'stash',
          label: t('Stash'),
          submenu: [
            {
              key: 'stash-all',
              label: t('Stash all changes…'),
              disabled: !canStash,
              onSelect: () => onAsk({ kind: 'stash' }),
            },
            {
              key: 'stash-staged',
              label: t('Stash staged changes…'),
              disabled: !canStash || !staged.length,
              onSelect: () => onAsk({ kind: 'stash', staged: true }),
            },
            { key: 'stash-sep', separator: true },
            {
              key: 'pop-latest',
              label: t('Pop latest stash'),
              disabled: !stashes.length,
              onSelect: () => void popStash(stashes[0]!),
            },
            {
              key: 'pop-stash',
              label: t('Pop stash…'),
              disabled: !stashes.length,
              submenu: stashes.map((stash) => ({
                key: stash.oid,
                label: stash.subject,
                title: stash.subject,
                onSelect: () => void popStash(stash),
              })),
            },
            {
              key: 'apply-stash',
              label: t('Apply stash…'),
              disabled: !stashes.length,
              submenu: stashes.map((stash) => ({
                key: stash.oid,
                label: stash.subject,
                title: stash.subject,
                onSelect: () => void applyStash(stash),
              })),
            },
          ],
        },
      ]}
    />
  )
}
