import { useEffect, useState, type ReactNode } from 'react'
import { Archive, ChevronRight } from 'lucide-react'
import type { GitCommitFile, GitStash, RepositoryBinding } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { ContentSkeleton } from '@/components/content-skeleton'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { useWorkspace } from '../workspace/workspace'
import { FILE_ROW, FileRowLabel } from './FileRow'
import { useHost } from '../workspace/HostProvider'

export function StashRow({
  taskId,
  binding,
  stash,
  children,
}: {
  taskId: string
  binding: RepositoryBinding
  stash: GitStash
  children: ReactNode
}) {
  useLanguage()
  const ws = useWorkspace()
  const { invoke } = useHost()
  const [expanded, setExpanded] = useState(false)
  const [files, setFiles] = useState<GitCommitFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!expanded || files) return
    let disposed = false
    setError(null)
    void invoke('git.stashFiles', taskId, binding.repoId, stash.oid).then(
      (value) => {
        if (!disposed) setFiles(value)
      },
      (reason) => {
        if (!disposed) setError(errorText(reason))
      },
    )
    return () => {
      disposed = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [expanded, files, taskId, binding.repoId, stash.oid, attempt] by design; the values it reads beyond these are current as of that run
  }, [expanded, files, taskId, binding.repoId, stash.oid, attempt])
  const openDiff = (file: GitCommitFile, preview?: false) =>
    ws.openView(taskId, {
      kind: 'diff',
      repoId: binding.repoId,
      oid: stash.oid,
      stash: true,
      path: file.path,
      staged: false,
      preview,
    })
  return (
    <div>
      <div className="stash-row">
        <Button
          variant="tree"
          className="stash-name h-7 px-0 justify-start [&:hover:not(:disabled)]:bg-transparent"
          aria-expanded={expanded}
          title={`${stash.ref} · ${stash.subject}`}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRight size={12} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
          <Archive size={13} />
          <span>{stash.subject.replace(/^On [^:]+: /, '')}</span>
        </Button>
        {children}
      </div>
      {expanded && (
        <div className="ml-3.5 border-l border-border pl-2 my-1">
          {error ? (
            <div className="px-2 py-1 text-caption">
              <p className="text-bad" role="alert">
                {error}
              </p>
              <Button variant="ghost" size="sm" onClick={() => setAttempt(attempt + 1)}>
                {t('Retry')}
              </Button>
            </div>
          ) : files ? (
            files.length ? (
              files.map((file) => (
                <Button
                  key={file.path}
                  variant="tree"
                  className={`${FILE_ROW} w-full px-1 text-left justify-start`}
                  title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
                  onClick={() => openDiff(file)}
                  onDoubleClick={() => openDiff(file, false)}
                >
                  <FileRowLabel
                    gutter={false}
                    path={file.path}
                    name={file.path.slice(file.path.lastIndexOf('/') + 1)}
                    dir={file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : undefined}
                  />
                  <span className="flex-1" />
                  <span
                    className={`letter text-caption flex-none ${file.status === 'A' ? 'text-good' : file.status === 'D' ? 'text-bad' : 'text-muted-foreground'}`}
                  >
                    {file.status}
                  </span>
                </Button>
              ))
            ) : (
              <p className="px-2 py-1 text-caption text-muted-foreground">{t('No file changes.')}</p>
            )
          ) : (
            <ContentSkeleton rows={3} label={t('Loading changes…')} />
          )}
        </div>
      )}
    </div>
  )
}
