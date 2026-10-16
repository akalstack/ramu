import type { ReactNode } from 'react'
import { Folder, Quote, SquareTerminal, WandSparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { FileIcon } from '../editor/FileIcon'
import { SKILL_REFERENCE_PREFIX } from '@ramu/shared/chat/chatReferences'
import { composerDraft } from '@ramu/shared/chat/composerDraft'
import { localFileLink } from '@ramu/shared/workspace/fileLinks'
import { t, useLanguage } from '../i18n'
import { invoke } from '../ipc'
import { useWorkspace } from '../workspace/workspace'
import { errorText } from '../workspace/TaskPane'
import { notifyError } from './Notifications'

function SkillReference({ name }: { name: string }) {
  useLanguage()
  return (
    <Badge variant="secondary" className="chat-reference" title={`${t('Skill')}: ${name}`}>
      <WandSparkles data-icon="inline-start" className="text-brand" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </Badge>
  )
}

export function ChatLink({ href, children, taskId }: { href?: string; children: ReactNode; taskId?: string }) {
  useLanguage()
  const ws = useWorkspace()
  if (href?.startsWith(SKILL_REFERENCE_PREFIX)) {
    let name: string
    try {
      name = decodeURIComponent(href.slice(SKILL_REFERENCE_PREFIX.length))
    } catch {
      return <>{children}</>
    }
    return <SkillReference name={name} />
  }
  const local = href && localFileLink(href)
  // A path whose last part has no extension (`apps/web`, `src/`) is most likely a folder; the server decides.
  const folderLike =
    !!local && (/\/$/.test(local.path) || !/\.[^/]+$|(?:^|\/)(?:README|LICENSE|Makefile|Dockerfile)$/i.test(local.path))
  if (local)
    return (
      <Badge
        variant="secondary"
        className="chat-reference"
        render={<a href={href} />}
        title={folderLike ? t('Show {0} in Explorer', { '0': href }) : t('Open {0} in editor', { '0': href })}
        onClick={(event) => {
          event.preventDefault()
          if (!taskId || !href) return
          // Composer mentions carry a repository name; resolve that prefix to the checkout first.
          const binding = (ws.bindings[ws.workspaceOf(taskId)] ?? ws.bindings[taskId] ?? []).find((entry) =>
            local.path.startsWith(`${entry.repoName}/`),
          )
          const target = binding
            ? `${binding.cwd}/${local.path.slice(binding.repoName.length + 1)}${local.line ? `:${local.line}:${local.column ?? 1}` : ''}`
            : href
          void invoke('files.resolveLink', taskId, target, { folders: true })
            .then((file) => {
              if (!file)
                throw new Error('This path was not found in this thread’s folders, or it matches more than one place.')
              // A folder opens in the Explorer, expanded and scrolled into view.
              if (file.kind === 'folder') {
                ws.setSidebar('explorer')
                window.dispatchEvent(new Event('ramu:show-explorer'))
                requestAnimationFrame(() =>
                  window.dispatchEvent(
                    new CustomEvent('ramu:explorer-reveal', { detail: { repoId: file.repoId, path: file.path } }),
                  ),
                )
                return
              }
              ws.openView(taskId, {
                kind: 'file',
                repoId: file.repoId,
                path: file.path,
                ...(file.line
                  ? {
                      selection: {
                        line: file.line,
                        column: file.column ?? 1,
                        endColumn: file.column ?? 1,
                        requestId: crypto.randomUUID(),
                      },
                    }
                  : {}),
              })
            })
            .catch((error) => notifyError(errorText(error), 'Open file'))
        }}
      >
        {folderLike ? <Folder aria-hidden="true" /> : <FileIcon path={local.path} />}
        <span className="truncate">{children}</span>
      </Badge>
    )
  const external = href && /^https?:\/\//i.test(href)
  return (
    <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>
      {children}
    </a>
  )
}

/** User messages stay plain text, with explicit references rendered inline. */
export function ReferenceText({ text, taskId }: { text: string; taskId?: string }) {
  const segments = composerDraft(text + ' ').segments
  return (
    <>
      {segments.map((part, index) =>
        part.kind === 'text' ? (
          index === segments.length - 1 ? (
            part.source.slice(0, -1)
          ) : (
            part.source
          )
        ) : part.kind === 'skill' ? (
          <SkillReference key={index} name={part.target!} />
        ) : part.kind === 'file' ? (
          <ChatLink key={index} href={part.target} taskId={taskId}>
            {part.label}
          </ChatLink>
        ) : (
          <Badge key={index} variant="secondary" className="chat-reference" title={part.label}>
            {part.kind === 'quote' ? (
              <Quote data-icon="inline-start" aria-hidden="true" />
            ) : (
              <SquareTerminal data-icon="inline-start" aria-hidden="true" />
            )}
            <span className="truncate">{part.label.replace(/\n/g, ' ')}</span>
          </Badge>
        ),
      )}
    </>
  )
}
