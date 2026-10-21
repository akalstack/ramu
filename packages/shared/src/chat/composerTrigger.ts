/** `/` lists commands and skills, `@` lists files and `$` lists skills only. */
export type ComposerTriggerMode = '/' | '@' | '$'
export interface ComposerTrigger {
  mode: ComposerTriggerMode
  /** Text typed after the trigger character, as written. */
  query: string
  /** Index of the trigger character. */
  start: number
}

/**
 * The completion token ending at the caret, shared by the desktop and mobile pickers. A `$` only opens the
 * skill list when followed by nothing or a name, so prices and shell text such as `$5` or `$(pwd)` stay text.
 */
export function composerTrigger(text: string, caret: number): ComposerTrigger | null {
  const prefix = text.slice(0, caret)
  const match = prefix.match(/(?:^|\s)([@/$])([^\s]*)$/)
  if (!match) return null
  const mode = match[1] as ComposerTriggerMode
  const query = match[2]!
  if (mode === '$' && query && !/^[A-Za-z][\w.:-]*$/.test(query)) return null
  return { mode, query, start: prefix.length - query.length - 1 }
}

/** Replaces the typed trigger and query with the accepted choice, keeping text after the caret. */
export function acceptComposerTrigger(
  text: string,
  caret: number,
  trigger: ComposerTrigger,
  insertion: string,
): { value: string; caret: number } {
  return {
    value: text.slice(0, trigger.start) + insertion + text.slice(caret),
    caret: trigger.start + insertion.length,
  }
}
