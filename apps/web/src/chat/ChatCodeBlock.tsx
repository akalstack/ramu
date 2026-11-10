import { lazy, Suspense } from 'react'
const MermaidBlock = lazy(() => import('./MermaidBlock').then((m) => ({ default: m.MermaidBlock })))
import { useEffect, useState, type ComponentProps } from 'react'
import type { Components, ExtraProps } from 'react-markdown'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@/components/ui/code-block'
import { codeBlockLabel } from '@ramu/shared/workspace/codeLanguage'
import { FileIcon } from '../editor/FileIcon'
import { copyText } from '../ipc'
import { errorText } from '../lib/errors'
import { notifyError } from './Notifications'
import { t, useLanguage } from '../i18n'
import { useColorizedLines } from '../editor/colorize'

export function ChatCodeBlock({ source, hint }: { source: string; hint?: string }) {
  useLanguage()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied, source])
  useEffect(() => setCopied(false), [source])
  const header = codeBlockLabel(source, hint)
  const lines = useColorizedLines(source, hint)
  const colored = lines ? lines.join('<br/>') : null
  const copy = async () => {
    try {
      await copyText(source)
      setCopied(true)
    } catch (error) {
      notifyError(errorText(error), t('Copy code'))
    }
  }
  return (
    <CodeBlock className="mt-1 mb-3 border-transparent bg-(--code-bg) dark:bg-(--code-bg)">
      <CodeBlockHeader className="border-b border-line px-3.5 py-1.5 pt-1.5">
        {/* As on the phone: the file the fence names, "Path" for a lone path, or the language, with its file icon. */}
        <CodeBlockTitle
          className="flex min-w-0 items-center gap-1.5 font-normal text-caption text-muted-foreground"
          title={header.title}
        >
          <FileIcon path={header.icon} size={14} className="flex-none" />
          <span className="truncate">{header.label === 'Path' ? t('Path') : header.label}</span>
        </CodeBlockTitle>
        <CodeBlockActions>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:bg-transparent hover:text-foreground"
            aria-label={copied ? t('Copied') : t('Copy code')}
            title={copied ? t('Copied') : t('Copy code')}
            onClick={() => void copy()}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </Button>
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent className="px-3.5 py-3 text-[length:0.88em] leading-[1.6] text-(--text-body)">
        {colored === null ? (
          source
        ) : (
          <span className="monaco-colorized" dangerouslySetInnerHTML={{ __html: colored }} />
        )}
      </CodeBlockContent>
    </CodeBlock>
  )
}

/** Fenced and indented code share the toolbar; inline code stays inline. */
/** A fenced code block: a Mermaid diagram, or the code frame with its language and Copy. */
export function ChatCodePre({ node, children }: ComponentProps<'pre'> & ExtraProps) {
  const code = node?.children.find((child) => child.type === 'element' && child.tagName === 'code')
  if (!code || code.type !== 'element') return <pre>{children}</pre>
  const source = code.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
  const classes = code.properties.className
  const hint = (Array.isArray(classes) ? classes : [])
    .map(String)
    .find((name) => name.startsWith('language-'))
    ?.slice(9)
  return hint?.toLowerCase() === 'mermaid' ? (
    <Suspense
      fallback={
        <pre>
          <code>{source}</code>
        </pre>
      }
    >
      <MermaidBlock source={source} />
    </Suspense>
  ) : (
    <ChatCodeBlock source={source} hint={hint} />
  )
}

export const chatCodeComponents: Components = { pre: ChatCodePre }
