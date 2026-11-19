// Syntax colors for code shown outside an editor (chat code blocks, pull request diffs), with the same Shiki grammars
// and theme as the editor, so code reads the same everywhere in Ramu.
import { useEffect, useState } from 'react'
import { codeLanguage } from '@ramu/shared/workspace/codeLanguage'
import { monaco } from './monaco'
import { loadShikiLanguage } from './shiki'

/** Large sources stay plain text: coloring them would hold up the view for little gain. */
const MAX_COLORIZED = 100_000

/** The editor language for some source, from a hint (a fence's language or a file extension) or its content. */
function grammarFor(source: string, hint?: string) {
  const language = codeLanguage(source, hint)
  // The last registration wins an extension, so .tsx and .jsx reach the React languages.
  const languages = monaco.languages.getLanguages()
  return (
    languages.find((entry) => entry.id === language) ??
    languages.findLast((entry) => entry.extensions?.includes(`.${language}`))
  )
}

/**
 * The source as escaped HTML with one span per token, one line per entry, or null when it has no known language or is
 * too large. Waits for Shiki's grammar so it is colored once, not first by Monarch.
 */
export async function colorizeLines(source: string, hint?: string): Promise<string[] | null> {
  const grammar = source.length <= MAX_COLORIZED ? grammarFor(source, hint) : undefined
  if (!grammar) return null
  await loadShikiLanguage(grammar.id)
  const html = await monaco.editor.colorize(source, grammar.id, { tabSize: 4 })
  return html.replace(/<br\/>$/, '').split('<br/>')
}

/** `colorizeLines` for a component: null until colored, and again whenever the source or hint changes. */
export function useColorizedLines(source: string, hint?: string): string[] | null {
  const [colored, setColored] = useState<{ source: string; hint?: string; lines: string[] } | null>(null)
  useEffect(() => {
    let cancelled = false
    colorizeLines(source, hint).then(
      (lines) => {
        if (!cancelled && lines) setColored({ source, hint, lines })
      },
      () => {
        // A grammar that cannot load leaves the source as plain text.
      },
    )
    return () => {
      cancelled = true
    }
  }, [source, hint])
  return colored?.source === source && colored.hint === hint ? colored.lines : null
}
