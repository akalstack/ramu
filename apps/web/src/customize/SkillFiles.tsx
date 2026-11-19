import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { RowButton } from '@/components/row-button'
import { cn } from 'cn'
import { ChatCodeBlock } from '../chat/ChatCodeBlock'
import { FileIcon } from '../editor/FileIcon'
import { PullRequestMarkdown } from '../git/PullRequestMarkdown'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'

export interface SkillFile {
  path: string
  bytes: number
  script?: boolean
}

const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`

/** The instructions without their name-and-description header, which the dialog already shows. */
const body = (markdown: string) => markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim()

/**
 * A skill's files to read before trusting it: SKILL.md (what every agent is told) open first, then any other file on
 * a click, scripts marked since they are code an agent may be asked to run.
 */
export function SkillFiles({
  markdown,
  files,
  read,
  changed,
}: {
  markdown: string
  files: SkillFile[]
  /** The file's text; null for a binary file or one too large to show. */
  read: (path: string) => Promise<string | null>
  /** Paths an update adds or changes, marked in the list. */
  changed?: Set<string>
}) {
  useLanguage()
  const [selected, setSelected] = useState('SKILL.md')
  const [source, setSource] = useState(false)
  const [text, setText] = useState<{ path: string; value: string | null; error?: string } | null>(null)
  const others = files.filter((file) => file.path !== 'SKILL.md').sort((a, b) => a.path.localeCompare(b.path))
  useEffect(() => {
    if (selected === 'SKILL.md') return
    let current = true
    read(selected).then(
      (value) => current && setText({ path: selected, value }),
      (reason) => current && setText({ path: selected, value: null, error: errorText(reason) }),
    )
    return () => {
      current = false
    }
  }, [selected, read])
  const row = (file: SkillFile, label?: string) => (
    <li key={file.path}>
      <RowButton
        size="sm"
        aria-current={selected === file.path ? 'true' : undefined}
        className={cn(
          'w-full gap-2 rounded-(--radius-s) px-2 text-left',
          selected === file.path && 'bg-hover text-foreground',
        )}
        onClick={() => {
          setSelected(file.path)
          setSource(false)
        }}
      >
        <FileIcon path={file.path} size={13} className="flex-none" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={file.path}>
          {label ?? file.path}
        </span>
        {changed?.has(file.path) && (
          <span className="size-1.5 flex-none rounded-full bg-(--brand)" aria-label={t('Changed')} />
        )}
        {file.script && <TriangleAlert size={12} className="flex-none text-warn" aria-label={t('Script')} />}
      </RowButton>
    </li>
  )
  const skillFile = files.find((file) => file.path === 'SKILL.md') ?? { path: 'SKILL.md', bytes: markdown.length }
  const file = files.find((entry) => entry.path === selected)
  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(150px,200px)_minmax(0,1fr)]">
      <ul
        className="m-0 flex max-h-80 list-none flex-col gap-0.5 overflow-auto rounded-(--radius-s) bg-fill p-1"
        aria-label={t('Files')}
      >
        {row(skillFile)}
        {others.map((entry) => row(entry))}
      </ul>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
          <span className="min-w-0 truncate font-mono">
            {selected} · {size(file?.bytes ?? skillFile.bytes)}
          </span>
          {selected === 'SKILL.md' && (
            <RowButton size="sm" className="w-auto flex-none px-2" onClick={() => setSource((value) => !value)}>
              {source ? t('Show formatted') : t('Show source')}
            </RowButton>
          )}
        </div>
        {file?.script && (
          <p className="m-0 flex items-start gap-1.5 text-caption text-warn">
            <TriangleAlert size={12} className="mt-0.5 flex-none" aria-hidden />
            {t('A script: agents may be told to run it. Read it before you copy it.')}
          </p>
        )}
        <div className="max-h-80 min-w-0 overflow-auto rounded-(--radius-s) border border-line p-3">
          {selected === 'SKILL.md' ? (
            source ? (
              <ChatCodeBlock source={markdown} hint="SKILL.md" />
            ) : (
              <PullRequestMarkdown>{body(markdown)}</PullRequestMarkdown>
            )
          ) : text?.path !== selected ? (
            <p className="m-0 text-caption text-muted-foreground">{t('Loading…')}</p>
          ) : text.error ? (
            <p className="m-0 text-caption text-bad">{text.error}</p>
          ) : text.value === null ? (
            <p className="m-0 text-caption text-muted-foreground">
              {t('This file is binary or too large to show here.')}
            </p>
          ) : (
            <ChatCodeBlock source={text.value} hint={selected} />
          )}
        </div>
      </div>
    </div>
  )
}
