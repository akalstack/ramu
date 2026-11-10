import { interactivePaletteFromVariant, interactiveThemeVariables } from '@ramu/shared/interactiveTheme'
import { DEFAULT_DARK, DEFAULT_LIGHT } from '@ramu/shared/theme'

/** The app's live palette as the theme tokens a document is drawn with. */
export function appThemeVariables(): Record<string, string> {
  const style = getComputedStyle(window.document.documentElement)
  const dark = style.colorScheme !== 'light'
  const fallback = interactivePaletteFromVariant(dark ? DEFAULT_DARK : DEFAULT_LIGHT, dark ? 'dark' : 'light')
  const read = (name: string, value: string) => style.getPropertyValue(name).trim() || value
  return interactiveThemeVariables({
    scheme: fallback.scheme,
    background: read('--canvas', fallback.background),
    foreground: read('--text', fallback.foreground),
    muted: read('--muted', fallback.muted),
    primary: read('--accent', fallback.primary),
    surface: read('--raised', fallback.surface),
    surfaceRaised: read('--bubble', fallback.surfaceRaised),
    codeBackground: read('--code-bg', fallback.codeBackground),
    button: read('--primary', fallback.button),
    buttonForeground: read('--primary-ink', fallback.buttonForeground),
    success: read('--ok', fallback.success),
    warning: read('--warn', fallback.warning),
    danger: read('--bad', fallback.danger),
  })
}
