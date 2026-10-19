import { lazy, Suspense } from 'react'
const MermaidBlock = lazy(() => import('./MermaidBlock').then((m) => ({ default: m.MermaidBlock })))
import { useEffect, useState } from 'react'
import type { Components } from 'react-markdown'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@/components/ui/code-block'
import { codeLanguage } from '@ramu/shared/workspace/codeLanguage'
import { copyText } from '../ipc'
import { errorText } from '../lib/errors'
import { notifyError } from './Notifications'
import { t, useLanguage } from '../i18n'
import { monaco } from '../editor/monaco'
import { loadShikiLanguage } from '../editor/shiki'

export function ChatCodeBlock({ source, hint }: { source: string; hint?: string }) {
  useLanguage()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied, source])
  useEffect(() => setCopied(false), [source])
  const language = codeLanguage(source, hint)
  const [highlighted, setHighlighted] = useState<{ source: string; language: string; html: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    // The last registration wins an extension, so .tsx and .jsx reach the React languages.
    const languages = monaco.languages.getLanguages()
    const grammar =
      languages.find((entry) => entry.id === language) ??
      languages.findLast((entry) => entry.extensions?.includes(`.${language}`))
    // Large logs stay responsive and readable as plain text.
    if (grammar && source.length <= 100_000) {
      // Wait for Shiki's grammar so the block is colored once, not first by Monarch.
      void loadShikiLanguage(grammar.id)
        .then(() => monaco.editor.colorize(source, grammar.id, { tabSize: 4 }))
        .then(
          (html) => {
            if (!cancelled) setHighlighted({ source, language, html: html.replace(/<br\/>$/, '') })
          },
          () => {
            /* Keep the original source when a grammar cannot load. */
          },
        )
    }
    return () => {
      cancelled = true
    }
  }, [source, language])
  const colored = highlighted?.source === source && highlighted.language === language ? highlighted.html : null
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
        <CodeBlockTitle className="font-normal text-caption text-muted-foreground">
          {language.includes('.') ? language : `.${language}`}
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
export const chatCodeComponents: Components = {
  pre: ({ node, children }) => {
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
  },
}
