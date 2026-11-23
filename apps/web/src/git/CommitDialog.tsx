import { useEffect, useMemo, useState } from 'react'
import { GitBranch, LoaderCircle, Sparkles } from 'lucide-react'
import type { CommitAction, CommitBranchOptions, GitStatus, GitStatusEntry } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { t, useLanguage } from '../i18n'
import { invoke } from '../ipc'
import { useAppSettings } from '../settings/AppSettings'
import { LETTER } from '../sidebar/scm/constants'
import { commitActionLabel } from '../sidebar/scm/helpers'
import { usePullRequestSupport } from './usePullRequestSupport'
import type { RamuBridge } from '@ramu/shared/api'
import { useHost } from '../workspace/HostProvider'

/** What the popup hands back: the files to commit, how far to take them, the branch, and an optional message. */
export interface CommitPlan {
  /** Every file that goes into the commit. Staged files outside it are unstaged; unstaged files inside it are staged. */
  paths: string[]
  action: CommitAction
  branch: CommitBranchOptions
  message: string
  /** Open the pull request dialog once the commit is pushed. */
  pullRequest: boolean
}

type Request = {
  taskId: string
  repoId: string
  repoName: string
  status: GitStatus
  action: CommitAction
  message: string
  /** Start with "Create a pull request after pushing" ticked. */
  pullRequest?: boolean
  resolve: (plan: CommitPlan | null) => void
}
let active: Request | null = null
let listener: ((request: Request | null) => void) | null = null

const stagedEntry = (entry: GitStatusEntry) => !!entry.staged && entry.staged !== 'unmerged'
/** Files that can go into a commit: everything except unresolved conflicts. */
export const committable = (status: GitStatus) =>
  status.entries.filter((entry) => entry.staged !== 'unmerged' && entry.unstaged !== 'unmerged')

/**
 * Asks what to commit. One popup for the header button, the shortcut and Source Control: the files (staged ones when
 * there are any, all changes otherwise, either one a click away), the message, the action and the branch.
 */
export function chooseCommit(request: Omit<Request, 'resolve'>): Promise<CommitPlan | null> {
  // A repeated shortcut must not replace a pending choice or start another commit.
  if (active) return Promise.resolve(null)
  if (!listener) return Promise.reject(new Error(t('The commit dialog is unavailable.')))
  return new Promise((resolve) => {
    active = { ...request, resolve }
    listener!(active)
  })
}

/**
 * Brings the index in line with the plan: selected files that are unstaged get staged, and staged files left out get
 * unstaged, so the commit holds exactly what was ticked.
 */
export async function applyCommitScope(
  taskId: string,
  repoId: string,
  status: GitStatus,
  paths: string[],
  /** The repository's host (`useHost().invoke`); the window's own host by default. */
  hostInvoke: RamuBridge['invoke'] = invoke,
) {
  const chosen = new Set(paths)
  const stage = status.entries.filter((e) => chosen.has(e.path) && e.unstaged && e.unstaged !== 'unmerged')
  const unstage = status.entries.filter((e) => !chosen.has(e.path) && stagedEntry(e))
  if (unstage.length)
    await hostInvoke(
      'git.unstage',
      taskId,
      repoId,
      unstage.map((e) => e.path),
    )
  if (stage.length)
    await hostInvoke(
      'git.stage',
      taskId,
      repoId,
      stage.map((e) => e.path),
    )
}

const ACTIONS: CommitAction[] = ['commit', 'push', 'sync']

export function CommitDialog() {
  useLanguage()
  const { preferences, save } = useAppSettings()
  const [request, setRequest] = useState<Request | null>(null)
  useEffect(() => {
    listener = setRequest
    return () => {
      listener = null
      active?.resolve(null)
      active = null
    }
  }, [])
  const finish = (plan: CommitPlan | null) => {
    // Resolve before clearing: the React Compiler folds a `const current = active` alias into a read after `active = null`.
    active?.resolve(plan)
    active = null
    setRequest(null)
  }
  if (!request) return null
  return (
    <CommitForm
      key={`${request.taskId}:${request.repoId}`}
      request={request}
      defaultAction={preferences.defaultCommitAction}
      defaultNewBranch={preferences.defaultCommitBranch === 'new-branch'}
      onRememberAction={(action) => {
        if (action !== preferences.defaultCommitAction)
          void save({ ...preferences, defaultCommitAction: action }).catch(() => {})
      }}
      onDone={finish}
    />
  )
}

function CommitForm({
  request,
  defaultAction,
  defaultNewBranch,
  onRememberAction,
  onDone,
}: {
  request: Request
  defaultAction: CommitAction
  defaultNewBranch: boolean
  onRememberAction: (action: CommitAction) => void
  onDone: (plan: CommitPlan | null) => void
}) {
  const host = useHost()
  const { status } = request
  const entries = useMemo(() => committable(status), [status])
  const hasStaged = entries.some(stagedEntry)
  // Staged files when there are any; the switch below widens it to everything.
  const [scope, setScope] = useState<'staged' | 'all'>(hasStaged ? 'staged' : 'all')
  const inScope = (entry: GitStatusEntry) => scope === 'all' || stagedEntry(entry)
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  // Files another thread in this checkout wrote last start unticked, so a commit takes only this thread's work.
  const [others, setOthers] = useState<Set<string>>(new Set())
  useEffect(() => {
    let cancelled = false
    void host.invoke('git.otherThreadPaths', request.taskId, request.repoId).then(
      (paths) => {
        if (cancelled || !paths.length) return
        const theirs = new Set(paths)
        setOthers(theirs)
        if (!hasStaged) setUnticked((current) => (current.size ? current : theirs))
      },
      // When the check fails, every file starts ticked.
      () => {},
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per opened popup
  }, [request.taskId, request.repoId])
  const selected = entries.filter((entry) => inScope(entry) && !unticked.has(entry.path))
  const [message, setMessage] = useState(request.message)
  const canPublish = !!status.branch && !!status.remote && !status.operation
  const prSupported = usePullRequestSupport(request.taskId, request.repoId, status.branch, status.remote)
  const canPr = canPublish && prSupported
  const [action, setAction] = useState<CommitAction>(
    request.action !== 'commit' ? request.action : canPublish ? defaultAction : 'commit',
  )
  // Support loads asynchronously; it controls discovery, not an already requested PR.
  // Keep that intent so a cold query or refetch cannot turn Commit, Push & PR into push only.
  const [openPr, setOpenPr] = useState(!!request.pullRequest && canPublish)
  // A pull request needs the commit on the remote, so it always pushes.
  const publishing = (openPr || action !== 'commit') && canPublish
  const chosenAction: CommitAction = openPr ? 'push' : publishing ? action : 'commit'
  const [branchInfo, setBranchInfo] = useState<{ branch: string | null; defaultBranch: string | null } | null>(null)
  const [newBranch, setNewBranch] = useState(false)
  // A new branch is named by AI from the commit (empty), or written here.
  const [branchName, setBranchName] = useState('')
  const [ownName, setOwnName] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void host.invoke('git.commitBranchInfo', request.taskId, request.repoId).then(
      (info) => {
        if (cancelled) return
        setBranchInfo(info)
        // Pushing straight to the default branch follows the saved preference; any other branch stays put.
        setNewBranch(!!info.branch && info.branch === info.defaultBranch && defaultNewBranch)
      },
      (reason: unknown) => !cancelled && setError(String(reason instanceof Error ? reason.message : reason)),
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [request.taskId, request.repoId, defaultNewBranch] by design; the values it reads beyond these are current as of that run
  }, [request.taskId, request.repoId, defaultNewBranch])
  const onDefault = !!branchInfo?.branch && branchInfo.branch === branchInfo.defaultBranch
  // A plain commit on the default branch hides the new-branch choice, so it never applies there.
  // A pull request cannot come from the default branch, so the commit moves to a new one.
  const wantsBranch = (newBranch || (openPr && onDefault)) && (publishing || !onDefault)

  const toggle = (path: string) =>
    setUnticked((current) => {
      const next = new Set(current)
      if (!next.delete(path)) next.add(path)
      return next
    })
  const submit = () => {
    if (!selected.length || (wantsBranch && ownName && !branchName.trim())) return
    if (publishing && !openPr) onRememberAction(action)
    onDone({
      pullRequest: openPr,
      paths: selected.map((entry) => entry.path),
      action: chosenAction,
      branch: !wantsBranch
        ? { expectedBranch: branchInfo?.branch ?? status.branch }
        : ownName && branchName.trim()
          ? { expectedBranch: branchInfo?.branch ?? status.branch, newBranch: branchName.trim() }
          : { expectedBranch: branchInfo?.branch ?? status.branch, autoBranch: true },
      message,
    })
  }
  const submitLabel = openPr ? t('Commit, Push & PR') : commitActionLabel(chosenAction)

  const SEGMENTS =
    'inline-flex flex-none gap-0.5 p-0.5 rounded-(--radius-s) bg-fill [&_button]:h-6 [&_button]:px-2.5 [&_button]:text-caption [&_button]:rounded-(--radius-xs) [&_button]:bg-transparent [&_button]:text-muted-foreground [&_button:hover:not(:disabled)]:text-foreground [&_[aria-pressed=true]]:bg-hover [&_[aria-pressed=true]]:text-foreground [&_button:disabled]:opacity-40'
  const LABEL = 'text-caption font-medium text-muted-foreground'
  const branchToggle = (
    <label className="flex cursor-pointer items-center gap-2 text-control text-soft">
      <Checkbox
        checked={newBranch || (openPr && onDefault)}
        disabled={openPr && onDefault}
        onCheckedChange={(value) => setNewBranch(!!value)}
      />
      {onDefault ? t('New branch (you are on {0})', { '0': branchInfo!.branch }) : t('Commit on a new branch')}
    </label>
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onDone(null)}>
      <DialogContent
        className="dialog flex max-h-[min(680px,calc(100vh-48px))] w-[min(520px,calc(100vw-48px))] sm:max-w-none flex-col gap-0 rounded-(--radius-l) p-0 [background:var(--float-bg)] [-webkit-backdrop-filter:var(--float-blur)] [backdrop-filter:var(--float-blur)] [border:1px_solid_var(--edge)] [box-shadow:0_24px_64px_rgba(0,_0,_0,_0.55)] ring-0"
        showCloseButton={false}
      >
        <DialogHeader className="flex-none gap-1 px-5 pt-[18px] pb-3">
          <DialogTitle className="text-heading font-semibold tracking-[-0.01em]">
            {t('Commit {0}', { '0': request.repoName })}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <GitBranch size={12} className="flex-none" />
            <span className="truncate">{branchInfo?.branch ?? status.branch ?? t('No branch')}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-none items-center gap-2 px-5 pb-2">
          <span className={LABEL}>{t('{0} of {1} files', { '0': selected.length, '1': entries.length })}</span>
          <span className="flex-1" />
          {hasStaged && (
            <div role="group" aria-label={t('Files to commit')} className={SEGMENTS}>
              {(['staged', 'all'] as const).map((value) => (
                <Button
                  key={value}
                  variant="ghost"
                  size="xs"
                  aria-pressed={scope === value}
                  onClick={() => {
                    setScope(value)
                    setUnticked(new Set())
                  }}
                >
                  {value === 'staged'
                    ? t('Staged · {0}', { '0': entries.filter(stagedEntry).length })
                    : t('All · {0}', { '0': entries.length })}
                </Button>
              ))}
            </div>
          )}
        </div>

        <ul
          className="mx-5 m-0 min-h-[60px] flex-1 list-none overflow-auto rounded-(--radius-m) bg-fill p-1"
          aria-label={t('Files to commit')}
        >
          {entries.filter(inScope).map((entry) => {
            const change = entry.unstaged ?? entry.staged
            const slash = entry.path.lastIndexOf('/')
            return (
              <li key={entry.path} className="list-none">
                <label className="flex h-7 cursor-pointer items-center gap-2 rounded-(--radius-s) px-2 text-control hover:bg-hover">
                  <Checkbox checked={!unticked.has(entry.path)} onCheckedChange={() => toggle(entry.path)} />
                  <span className="min-w-0 flex-1 truncate" title={entry.path}>
                    <span className="text-foreground">{entry.path.slice(slash + 1)}</span>
                    {slash > 0 && (
                      <span className="ml-1.5 text-caption text-muted-foreground">{entry.path.slice(0, slash)}</span>
                    )}
                  </span>
                  {others.has(entry.path) && (
                    <span className="flex-none text-caption text-muted-foreground">{t('Another thread')}</span>
                  )}
                  <span className="flex-none text-caption font-semibold text-muted-foreground">
                    {LETTER[change ?? ''] ?? ''}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>

        <div className="flex flex-none flex-col gap-2 px-5 pt-3">
          <span className={LABEL}>{t('Message')}</span>
          <Textarea
            rows={2}
            maxLength={100000}
            className="min-h-[52px] resize-none"
            value={message}
            placeholder={t('Message (leave empty for AI to write one)')}
            aria-label={t('Commit message')}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit()
            }}
          />
        </div>

        <div className="flex flex-none flex-col gap-2.5 px-5 pt-3">
          <div role="group" aria-label={t('After committing')} className={SEGMENTS + ' self-start'}>
            {ACTIONS.map((value) => (
              <Button
                key={value}
                variant="ghost"
                size="xs"
                aria-pressed={chosenAction === value}
                disabled={value !== 'commit' && !canPublish}
                title={
                  value !== 'commit' && !canPublish ? t('This repository has no branch with a remote.') : undefined
                }
                onClick={() => {
                  setAction(value)
                  setOpenPr(false)
                }}
              >
                {commitActionLabel(value)}
              </Button>
            ))}
          </div>
          {(onDefault ? publishing : true) && branchToggle}
          {wantsBranch && (
            <div className="flex flex-col gap-1.5 pl-6">
              <div className="flex items-center gap-2">
                <span className={LABEL}>{t('Branch name')}</span>
                <span className="flex-1" />
                <div role="group" aria-label={t('Branch name')} className={SEGMENTS}>
                  <Button variant="ghost" size="xs" aria-pressed={!ownName} onClick={() => setOwnName(false)}>
                    <Sparkles size={12} />
                    {t('AI')}
                  </Button>
                  <Button variant="ghost" size="xs" aria-pressed={ownName} onClick={() => setOwnName(true)}>
                    {t('Write my own')}
                  </Button>
                </div>
              </div>
              {ownName ? (
                <Input
                  autoFocus
                  value={branchName}
                  maxLength={200}
                  placeholder={t('feature/my-change')}
                  aria-label={t('Branch name')}
                  onChange={(event) => setBranchName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') submit()
                  }}
                />
              ) : (
                <p className="m-0 text-caption text-muted-foreground">
                  {t('Named from your changes when you commit. Staged and unstaged files are kept.')}
                </p>
              )}
            </div>
          )}
          {(canPr || openPr) && (
            <label className="flex cursor-pointer items-center gap-2 text-control text-soft">
              <Checkbox checked={openPr} onCheckedChange={(value) => setOpenPr(!!value)} />
              {t('Create a pull request after pushing')}
            </label>
          )}
        </div>

        {error && (
          <p role="alert" className="mx-5 mt-2 mb-0 text-caption text-bad">
            {error}
          </p>
        )}
        <div className="dialog-actions mt-4 flex flex-none flex-wrap items-center justify-end gap-2 px-5 pb-4">
          <Button variant="outline" className="whitespace-nowrap" onClick={() => onDone(null)}>
            {t('Cancel')}
          </Button>
          <Button
            variant="default"
            className="primary whitespace-nowrap bg-primary font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            disabled={!selected.length || !branchInfo || (wantsBranch && ownName && !branchName.trim())}
            autoFocus
            onClick={submit}
          >
            {!branchInfo && <LoaderCircle className="animate-spin" />}
            {submitLabel}
            <span className="font-normal opacity-80">{selected.length}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
