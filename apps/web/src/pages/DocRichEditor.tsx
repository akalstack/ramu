import { useEffect, useRef, useState } from 'react'
import { monaco } from '../editor/monaco'
import { mergeText } from '@ramu/shared/textMerge'
import { MarkdownEditor, richTextMarkdown } from '../editor/MarkdownEditor'

/** Footnotes and raw HTML do not survive the rich-text round trip, so a doc with either is edited as Markdown. */
export const richTextFits = (markdown: string) => !/\[\^[^\]]+\]|^ {0,3}<[A-Za-z!/]/m.test(markdown)

/**
 * The doc as the person changed it in rich text: their changes put onto the Markdown as written, so lines they did
 * not touch keep the agent's spelling (`*` bullets, `__bold__`, reference links, table spacing) instead of the
 * editor's. Where a change overlaps that respelling, the editor's Markdown is used as it is.
 */
export function keepWritten(written: { raw: string; rich: string }, edited: string): string {
  // Merged block by block (the text between blank lines), since the editor also respaces the blank lines themselves.
  const merged = mergeText(asBlocks(written.rich), asBlocks(edited), asBlocks(written.raw))
  if (merged === null) return edited
  return (
    merged
      .split('\n')
      .map((block) => block.replaceAll(LINE, '\n'))
      .join('\n\n') + (/\n$/.test(edited) ? '\n' : '')
  )
}
const LINE = '\u0000'
/** One line per block, its own line breaks held as a character no Markdown has. */
const asBlocks = (text: string) =>
  text
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n[ \t]*\n\s*/)
    .map((block) => block.replaceAll('\n', LINE))
    .join('\n')

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
  // The Markdown the person's changes are put back onto, and the rich editor's spelling of it.
  const written = useRef<{ raw: string; rich: string } | null>(null)
  // What this editor last handed out, so it is not taken back in as someone else's typing.
  const handed = useRef<string | null>(null)
  const latest = useRef(onChange)
  useEffect(() => {
    latest.current = onChange
  }, [onChange])
  useEffect(() => {
    const created = monaco.editor.createModel(initial.current, 'markdown')
    written.current = { raw: initial.current, rich: richTextMarkdown(initial.current) }
    const changed = created.onDidChangeContent(() => {
      const value = created.getValue()
      const next = written.current ? keepWritten(written.current, value) : value
      handed.current = next
      latest.current(next)
    })
    setModel(created)
    return () => {
      changed.dispose()
      setModel(null)
      created.dispose()
    }
  }, [])
  // Text from outside (others' live typing) goes into the model as one edit over the span that changed, so the
  // cursor and selection elsewhere stay where they were.
  useEffect(() => {
    if (!model || model.getValue() === text || handed.current === text) return
    const from = model.getValue()
    written.current = { raw: text, rich: richTextMarkdown(text) }
    let start = 0
    while (start < from.length && start < text.length && from[start] === text[start]) start++
    let end = 0
    while (
      end < from.length - start &&
      end < text.length - start &&
      from[from.length - 1 - end] === text[text.length - 1 - end]
    )
      end++
    const range = monaco.Range.fromPositions(model.getPositionAt(start), model.getPositionAt(from.length - end))
    model.applyEdits([{ range, text: text.slice(start, text.length - end) }])
  }, [model, text])
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
