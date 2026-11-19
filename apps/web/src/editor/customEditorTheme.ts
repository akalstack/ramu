import { resolvedAppearance } from '../appearance'
import { effectiveTheme, isCustomTheme, subscribeTheme } from '../theme/themes'
import { monaco } from './monaco'
import { editorColorsFor, editorThemeName, setCustomEditorTheme } from './editorTheme'
import { defineEditorTheme } from './shiki'

let version = 0
let timer: ReturnType<typeof setTimeout> | undefined

/**
 * Keeps Monaco's theme in step with the chosen color theme. A custom theme is registered under a fresh name, debounced
 * so dragging a color picker doesn't register one per frame; a newer change makes an older one's result a no-op.
 */
export function installEditorTheme() {
  const sync = () => {
    const theme = effectiveTheme()
    const appearance = resolvedAppearance()
    const mine = ++version
    clearTimeout(timer)
    if (!isCustomTheme(theme)) {
      setCustomEditorTheme(null)
      monaco.editor.setTheme(editorThemeName(appearance))
      return
    }
    timer = setTimeout(() => {
      const name = `ramu-custom-${mine}`
      void defineEditorTheme(name, appearance, editorColorsFor(theme, appearance)).then(() => {
        if (mine !== version) return
        setCustomEditorTheme(name)
        monaco.editor.setTheme(name)
      })
    }, 150)
  }
  sync()
  return subscribeTheme(sync)
}
