import { useEffect, useState } from 'react'
import type { Components } from 'react-markdown'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { codeLanguage } from '../../shared/codeLanguage'
import { copyText } from './ipc'
import { errorText } from './errors'
import { notifyError } from './Notifications'
import { t, useLanguage } from './i18n'
import { monaco } from './monaco'

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
    const grammar = monaco.languages.getLanguages().find((entry) => entry.id === language || entry.extensions?.includes(`.${language}`))
    // Large logs stay responsive and readable as plain text.
    if (grammar && source.length <= 100_000) {
      void monaco.editor.colorize(source, grammar.id, { tabSize: 4 }).then((html) => {
        if (!cancelled) setHighlighted({ source, language, html: html.replace(/<br\/>$/, '') })
      }, () => { /* Keep the original source when a grammar cannot load. */ })
    }
    return () => { cancelled = true }
  }, [source, language])
  const colored = highlighted?.source === source && highlighted.language === language ? highlighted.html : null
  const copy = async () => {
    try { await copyText(source); setCopied(true) }
    catch (error) { notifyError(errorText(error), t('Copy code')) }
  }
  return <div className="chat-code-block">
    <div className="chat-code-header"><span className="chat-code-language">{language.includes('.') ? language : `.${language}`}</span>
      <Button variant="ghost" size="sm" className="chat-code-copy" aria-label={copied ? t('Copied') : t('Copy code')} title={copied ? t('Copied') : t('Copy code')} onClick={() => void copy()}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </Button>
    </div>
    <pre>{colored === null ? <code>{source}</code> : <code className="monaco-colorized" dangerouslySetInnerHTML={{ __html: colored }} />}</pre>
  </div>
}

/** Fenced and indented code share the toolbar; inline code stays inline. */
export const chatCodeComponents: Components = {
  pre: ({ node, children }) => {
    const code = node?.children.find((child) => child.type === 'element' && child.tagName === 'code')
    if (!code || code.type !== 'element') return <pre>{children}</pre>
    const source = code.children.map((child) => child.type === 'text' ? child.value : '').join('')
    const classes = code.properties.className
    const hint = (Array.isArray(classes) ? classes : []).map(String).find((name) => name.startsWith('language-'))?.slice(9)
    return <ChatCodeBlock source={source} hint={hint} />
  },
}
