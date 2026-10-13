import { parse } from 'editorconfig'
import type { EditorConfigProps } from '@ramu/shared/types'
import { resolveInRoot } from './files'

/** Resolves .editorconfig settings for a file, stopping at the repository root. Unset properties stay undefined. */
export async function editorConfigFor(root: string, relPath: string): Promise<EditorConfigProps> {
  const abs = await resolveInRoot(root, relPath)
  const props = await parse(abs, { root })
  const out: EditorConfigProps = {}
  if (props.indent_style === 'space') out.indentStyle = 'space'
  else if (props.indent_style === 'tab') out.indentStyle = 'tab'
  const size = props.indent_size, tab = props.tab_width
  if (typeof size === 'number' && size > 0) out.indentSize = Math.min(size, 16)
  else if (size === 'tab') out.indentSize = 'tab'
  if (typeof tab === 'number' && tab > 0) out.tabWidth = Math.min(tab, 16)
  if (props.end_of_line === 'lf') out.endOfLine = 'lf'
  else if (props.end_of_line === 'crlf') out.endOfLine = 'crlf'
  if (typeof props.insert_final_newline === 'boolean') out.insertFinalNewline = props.insert_final_newline
  if (typeof props.trim_trailing_whitespace === 'boolean') out.trimTrailingWhitespace = props.trim_trailing_whitespace
  return out
}
