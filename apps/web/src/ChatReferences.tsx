import type { ReactNode } from 'react'
import { Quote, SquareTerminal, WandSparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { FileIcon } from './FileIcon'
import { SKILL_REFERENCE_PREFIX } from '@ramu/shared/chatReferences'
import { composerDraft } from '@ramu/shared/composerDraft'
import { localFileLink } from '@ramu/shared/fileLinks'
import { t, useLanguage } from './i18n'
import { invoke } from './ipc'
import { useWorkspace } from './workspace'
import { errorText } from './TaskPane'
import { notifyError } from './Notifications'

function SkillReference({ name }: { name: string }) {
  useLanguage()
  return <Badge variant="secondary" className="chat-reference" title={`${t('Skill')}: ${name}`}><WandSparkles data-icon="inline-start" className="text-brand" aria-hidden="true" /><span className="truncate">{name}</span></Badge>
}

export function ChatLink({ href, children, taskId }: { href?: string; children: ReactNode; taskId?: string }) {
  useLanguage()
  const ws = useWorkspace()
  if (href?.startsWith(SKILL_REFERENCE_PREFIX)) {
    let name: string
    try { name = decodeURIComponent(href.slice(SKILL_REFERENCE_PREFIX.length)) } catch { return <>{children}</> }
    return <SkillReference name={name} />
  }
  const local = href && localFileLink(href)
  if (local) return <Badge variant="secondary" className="chat-reference" render={<a href={href} />} title={t('Open {0} in editor', { '0': href })} onClick={(event) => {
    event.preventDefault()
    if (!taskId || !href) return
    // Composer mentions carry a repository name; resolve that prefix to the checkout first.
    const binding = (ws.bindings[ws.workspaceOf(taskId)] ?? ws.bindings[taskId] ?? []).find((entry) => local.path.startsWith(`${entry.repoName}/`))
    const target = binding ? `${binding.cwd}/${local.path.slice(binding.repoName.length + 1)}${local.line ? `:${local.line}:${local.column ?? 1}` : ''}` : href
    void invoke('files.resolveLink', taskId, target).then((file) => {
      if (!file) throw new Error('This file was not found in this chat’s folders, or the path matches more than one file.')
      ws.openView(taskId, { kind: 'file', repoId: file.repoId, path: file.path, ...(file.line ? { selection: { line: file.line, column: file.column ?? 1, endColumn: file.column ?? 1, requestId: crypto.randomUUID() } } : {}) })
    }).catch((error) => notifyError(errorText(error), 'Open file'))
  }}><FileIcon path={local.path} /><span className="truncate">{children}</span></Badge>
  const external = href && /^https?:\/\//i.test(href)
  return <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>{children}</a>
}

/** User messages stay plain text, with explicit references rendered inline. */
export function ReferenceText({ text, taskId }: { text: string; taskId?: string }) {
  const segments = composerDraft(text + ' ').segments
  return <>{segments.map((part, index) => part.kind === 'text' ? (index === segments.length - 1 ? part.source.slice(0, -1) : part.source) : part.kind === 'skill'
    ? <SkillReference key={index} name={part.target!} />
    : part.kind === 'file' ? <ChatLink key={index} href={part.target} taskId={taskId}>{part.label}</ChatLink>
    : <Badge key={index} variant="secondary" className="chat-reference" title={part.label}>{part.kind === 'quote' ? <Quote data-icon="inline-start" aria-hidden="true" /> : <SquareTerminal data-icon="inline-start" aria-hidden="true" />}<span className="truncate">{part.label.replace(/\n/g, ' ')}</span></Badge>)}</>
}
