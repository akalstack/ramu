import { useEffect, useRef, useState } from 'react'
import { monaco } from '../editor/monaco'
import { MarkdownEditor } from '../editor/MarkdownEditor'

/** Footnotes and raw HTML do not survive the rich-text round trip, so a doc with either is edited as Markdown. */
export const richTextFits = (markdown: string) => !/\[\^[^\]]+\]|^ {0,3}<[A-Za-z!/]/m.test(markdown)

/**
 * A doc's Markdown in the same rich-text editor as Markdown files, so the person edits formatted text rather than
 * syntax. What they type comes back as Markdown; nothing is rewritten until they change something.
 */
export function DocRichEditor({
  artifactId,
  text,
  onChange,
  onSave,
}: {
  artifactId: string
  text: string
  onChange: (markdown: string) => void
  onSave: () => void
}) {
  const [model, setModel] = useState<monaco.editor.ITextModel | null>(null)
  const initial = useRef(text)
  const latest = useRef(onChange)
  useEffect(() => {
    latest.current = onChange
  }, [onChange])
  useEffect(() => {
    const created = monaco.editor.createModel(initial.current, 'markdown')
    const changed = created.onDidChangeContent(() => latest.current(created.getValue()))
    setModel(created)
    return () => {
      changed.dispose()
      setModel(null)
      created.dispose()
    }
  }, [])
  if (!model) return null
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border border-(--line)">
      <MarkdownEditor
        model={model}
        viewId={`artifact:${artifactId}`}
        taskId=""
        repoId=""
        path="document.md"
        onSave={onSave}
        onOpenLink={() => {}}
      />
    </div>
  )
}
