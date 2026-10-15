import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  CloudDownload,
  MoreHorizontal,
  Minus,
  Plus,
  RefreshCcw,
  Undo2,
} from 'lucide-react'
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
  onAsk: (confirmation: Confirmation) => void
}) {
  const ws = useWorkspace()
  const { preferences } = useAppSettings()
  const { stagePaths, popStash, applyStash, sync, pull, pushRepo, fetchRepo } = actions
  return (
    <Menu
      disabled={disabled}
      label={t('Source control actions')}
      icon={<MoreHorizontal size={14} />}
      className={ICON_BUTTON}
      align="end"
      items={[
        {
          key: 'stage-all',
          label: (
            <>
              <Plus size={14} />
              {t('Stage all changes')}
            </>
          ),
          disabled: !unstaged.length,
          onSelect: () =>
            stagePaths(
              unstaged.map((entry) => entry.path),
              true,
            ),
        },
        {
          key: 'unstage-all',
          label: (
            <>
              <Minus size={14} />
              {t('Unstage all changes')}
            </>
          ),
          disabled: !staged.length,
          onSelect: () =>
            stagePaths(
              staged.map((entry) => entry.path),
              false,
            ),
        },
        {
          key: 'discard-all',
          label: (
            <>
              <Undo2 size={14} />
              {t('Discard all unstaged changes…')}
            </>
          ),
          danger: true,
          disabled: !unstaged.length,
          onSelect: () => onRequest({ kind: 'discard', paths: unstaged.map((entry) => entry.path) }),
        },
        {
          key: 'undo-commit',
          label: (
            <>
              <Undo2 size={14} />
              {t('Undo last commit…')}
            </>
          ),
          disabled: !canUndo,
          onSelect: () => {
            const head = commits.find((commit) => commit.oid === status?.oid)
            if (head) onRequest({ kind: 'undo', oid: head.oid, title: head.subject })
          },
        },
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
        { key: 'branches-sep', separator: true },
        {
          key: 'create-branch',
          label: t('Create branch…'),
          onSelect: () => onAsk({ kind: 'branch' }),
        },
        {
          key: 'delete-branch',
          label: t('Delete local branch'),
          disabled: !branches.some((branch) => !branch.current && !branch.worktree),
          submenu: branches
            .filter((branch) => !branch.current && !branch.worktree)
            .map((branch) => ({
              key: branch.name,
              label: branch.name,
              onSelect: () => onRequest({ kind: 'delete-branch', name: branch.name }),
            })),
        },
        { key: 'stash-sep', separator: true },
        {
          key: 'stash',
          label: (
            <>
              <Archive size={14} />
              {t('Stash all changes…')}
            </>
          ),
          disabled: !canStash,
          onSelect: () => onAsk({ kind: 'stash' }),
        },
        {
          key: 'stash-staged',
          label: (
            <>
              <Archive size={14} />
              {t('Stash staged changes…')}
            </>
          ),
          disabled: !canStash || !staged.length,
          onSelect: () => onAsk({ kind: 'stash', staged: true }),
        },
        {
          key: 'pop-latest',
          label: (
            <>
              <ArchiveRestore size={14} />
              {t('Pop latest stash')}
            </>
          ),
          disabled: !stashes.length,
          onSelect: () => void popStash(stashes[0]!),
        },
        {
          key: 'pop-stash',
          label: t('Pop stash'),
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
          label: t('Apply stash'),
          disabled: !stashes.length,
          submenu: stashes.map((stash) => ({
            key: stash.oid,
            label: stash.subject,
            title: stash.subject,
            onSelect: () => void applyStash(stash),
          })),
        },
        {
          key: 'drop-stash',
          label: t('Delete stash'),
          disabled: !stashes.length,
          submenu: stashes.map((stash) => ({
            key: stash.oid,
            label: stash.subject,
            title: stash.subject,
            onSelect: () => onRequest({ kind: 'drop-stash', oid: stash.oid, title: stash.subject }),
          })),
        },
        { key: 'sep', separator: true },
        {
          key: 'sync',
          label: (
            <>
              <RefreshCcw size={14} />
              {status?.upstream ? t('Sync changes') : t('Publish branch')}
            </>
          ),
          disabled: !status?.branch || !!status.operation,
          onSelect: sync,
        },
        {
          key: 'pull',
          label: (
            <>
              <ArrowDown size={14} />
              {t('Pull ({0})', { '0': PULL_NAME[preferences.pullMode] })}
            </>
          ),
          disabled: !!status?.operation,
          onSelect: () => pull(),
        },
        {
          key: 'pull-with',
          label: t('Pull with'),
          disabled: !!status?.operation,
          submenu: (['rebase', 'merge', 'ff-only'] as const)
            .filter((mode) => mode !== preferences.pullMode)
            .map((mode) => ({ key: mode, label: PULL_NAME[mode], onSelect: () => pull(mode) })),
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
      ]}
    />
  )
}
