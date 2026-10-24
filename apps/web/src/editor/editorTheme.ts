import type { RamuTheme, ThemeVariant } from '@ramu/shared/theme'
import { resolvedAppearance, type ResolvedAppearance } from '../appearance'

/**
 * Workbench colors of the `ramu` Monaco theme, matching the tokens in styles.css. Shiki supplies only the token colors;
 * the GitHub theme's workbench colors (near-black side surfaces, green bracket boxes, blue cursor) are not used.
 */
export const RAMU_EDITOR_COLORS = {
  foreground: '#c7c7cc',
  focusBorder: '#b7a6f366',
  'editor.background': '#1c1c1f',
  'editor.foreground': '#e4e4e7',
  'editorGutter.background': '#1c1c1f',
  'editor.lineHighlightBackground': '#ffffff08',
  'editor.lineHighlightBorder': '#00000000',
  'editor.selectionBackground': '#b7a6f340',
  'editor.inactiveSelectionBackground': '#b7a6f324',
  'editor.selectionHighlightBackground': '#b7a6f31f',
  'editor.wordHighlightBackground': '#ffffff12',
  'editor.wordHighlightStrongBackground': '#ffffff12',
  'editor.findMatchBackground': '#ffb34066',
  'editor.findMatchHighlightBackground': '#ffb34033',
  'editor.foldBackground': '#ffffff08',
  'editorCursor.foreground': '#b7a6f3',
  'editorLineNumber.foreground': '#5e5e66',
  'editorLineNumber.activeForeground': '#a1a1a8',
  'editorIndentGuide.background1': '#ffffff10',
  'editorIndentGuide.activeBackground1': '#ffffff24',
  'editorWhitespace.foreground': '#ffffff1f',
  'editorBracketMatch.background': '#ffffff12',
  'editorBracketMatch.border': '#00000000',
  'editorBracketHighlight.foreground1': '#c7c7cc',
  'editorBracketHighlight.foreground2': '#c7c7cc',
  'editorBracketHighlight.foreground3': '#c7c7cc',
  'editorBracketHighlight.unexpectedBracket.foreground': '#ff6961',
  'editorWidget.background': '#29292d',
  'editorWidget.border': '#ffffff12',
  'editorHoverWidget.background': '#29292d',
  'editorHoverWidget.border': '#ffffff12',
  'editorSuggestWidget.background': '#29292d',
  'editorSuggestWidget.border': '#ffffff12',
  'editorSuggestWidget.selectedBackground': '#ffffff14',
  'input.background': '#ffffff0d',
  'input.border': '#ffffff12',
  'list.hoverBackground': '#ffffff0e',
  'list.activeSelectionBackground': '#ffffff14',
  'list.focusBackground': '#ffffff14',
  'widget.shadow': '#00000059',
  'scrollbar.shadow': '#00000000',
  'scrollbarSlider.background': '#ffffff1a',
  'scrollbarSlider.hoverBackground': '#ffffff30',
  'scrollbarSlider.activeBackground': '#ffffff40',
  'editorOverviewRuler.border': '#00000000',
  'diffEditor.insertedTextBackground': '#30d15826',
  'diffEditor.insertedLineBackground': '#30d1580f',
  'diffEditor.removedTextBackground': '#ff696126',
  'diffEditor.removedLineBackground': '#ff69610f',
  'diffEditorGutter.insertedLineBackground': '#30d1581a',
  'diffEditorGutter.removedLineBackground': '#ff69611a',
  'diffEditor.diagonalFill': '#ffffff0a',
  'diffEditor.border': '#ffffff12',
  // Collapsed unchanged lines ("54 hidden lines") sit on a quiet raised strip, not the theme's black side bar.
  'diffEditor.unchangedRegionBackground': '#232327',
  'diffEditor.unchangedRegionForeground': '#a1a1a8',
  'diffEditor.unchangedRegionShadow': '#00000000',
  'diffEditor.unchangedCodeBackground': '#ffffff05',
  'editorGutter.addedBackground': '#30d158b3',
  'editorGutter.modifiedBackground': '#ffb340b3',
  'editorGutter.deletedBackground': '#ff6961b3',
}

/** The same workbench roles on the light canvas (`--canvas`, `--raised` and friends in styles.css). */
export const RAMU_EDITOR_COLORS_LIGHT = {
  foreground: '#46464d',
  focusBorder: '#7652d466',
  'editor.background': '#ffffff',
  'editor.foreground': '#26262b',
  'editorGutter.background': '#ffffff',
  'editor.lineHighlightBackground': '#00000008',
  'editor.lineHighlightBorder': '#00000000',
  'editor.selectionBackground': '#7652d433',
  'editor.inactiveSelectionBackground': '#7652d41f',
  'editor.selectionHighlightBackground': '#7652d41a',
  'editor.wordHighlightBackground': '#0000000f',
  'editor.wordHighlightStrongBackground': '#0000000f',
  'editor.findMatchBackground': '#ffb34099',
  'editor.findMatchHighlightBackground': '#ffb34055',
  'editor.foldBackground': '#00000008',
  'editorCursor.foreground': '#7652d4',
  'editorLineNumber.foreground': '#9a9aa2',
  'editorLineNumber.activeForeground': '#46464d',
  'editorIndentGuide.background1': '#0000000f',
  'editorIndentGuide.activeBackground1': '#00000024',
  'editorWhitespace.foreground': '#0000001f',
  'editorBracketMatch.background': '#0000000f',
  'editorBracketMatch.border': '#00000000',
  'editorBracketHighlight.foreground1': '#46464d',
  'editorBracketHighlight.foreground2': '#46464d',
  'editorBracketHighlight.foreground3': '#46464d',
  'editorBracketHighlight.unexpectedBracket.foreground': '#c62828',
  'editorWidget.background': '#ffffff',
  'editorWidget.border': '#0000001a',
  'editorHoverWidget.background': '#ffffff',
  'editorHoverWidget.border': '#0000001a',
  'editorSuggestWidget.background': '#ffffff',
  'editorSuggestWidget.border': '#0000001a',
  'editorSuggestWidget.selectedBackground': '#0000000f',
  'input.background': '#0000000d',
  'input.border': '#0000001a',
  'list.hoverBackground': '#0000000a',
  'list.activeSelectionBackground': '#00000014',
  'list.focusBackground': '#00000014',
  'widget.shadow': '#00000029',
  'scrollbar.shadow': '#00000000',
  'scrollbarSlider.background': '#0000001f',
  'scrollbarSlider.hoverBackground': '#00000038',
  'scrollbarSlider.activeBackground': '#00000048',
  'editorOverviewRuler.border': '#00000000',
  'diffEditor.insertedTextBackground': '#1a7f3730',
  'diffEditor.insertedLineBackground': '#1a7f3714',
  'diffEditor.removedTextBackground': '#c6282830',
  'diffEditor.removedLineBackground': '#c6282814',
  'diffEditorGutter.insertedLineBackground': '#1a7f3724',
  'diffEditorGutter.removedLineBackground': '#c6282824',
  'diffEditor.diagonalFill': '#0000000a',
  'diffEditor.border': '#0000001a',
  'diffEditor.unchangedRegionBackground': '#f6f6f8',
  'diffEditor.unchangedRegionForeground': '#62626a',
  'diffEditor.unchangedRegionShadow': '#00000000',
  'diffEditor.unchangedCodeBackground': '#00000005',
  'editorGutter.addedBackground': '#1a7f37b3',
  'editorGutter.modifiedBackground': '#9a5b00b3',
  'editorGutter.deletedBackground': '#c62828b3',
}

/** The registered name of the editor theme derived from a custom color theme, while one is in use. */
let customEditorTheme: string | null = null
export const setCustomEditorTheme = (name: string | null) => (customEditorTheme = name)

/** Monaco's theme is global; the name follows the resolved appearance, or the custom theme in use. */
export const editorThemeName = (appearance: 'light' | 'dark' = resolvedAppearance()) =>
  customEditorTheme ?? (appearance === 'light' ? 'ramu-light' : 'ramu')

/** Ramu's editor colors with the surfaces, text and accent taken from the theme. */
export function editorColorsFor(theme: RamuTheme, appearance: ResolvedAppearance): Record<string, string> {
  return editorColorsForVariant(theme[appearance], appearance)
}

/** The same workbench mapping for an isolated candidate preview. */
export function editorColorsForVariant(variant: ThemeVariant, appearance: ResolvedAppearance): Record<string, string> {
  const c = variant.colors
  const widget = c.raised
  return {
    ...(appearance === 'light' ? RAMU_EDITOR_COLORS_LIGHT : RAMU_EDITOR_COLORS),
    foreground: c.soft,
    focusBorder: `${c.accent}66`,
    'editor.background': c.canvas,
    'editor.foreground': c.textBody,
    'editorGutter.background': c.canvas,
    'editor.selectionBackground': `${c.accent}40`,
    'editor.inactiveSelectionBackground': `${c.accent}24`,
    'editor.selectionHighlightBackground': `${c.accent}1f`,
    'editorCursor.foreground': c.accent,
    'editorLineNumber.foreground': c.placeholder,
    'editorLineNumber.activeForeground': c.muted,
    'editorWidget.background': widget,
    'editorHoverWidget.background': widget,
    'editorSuggestWidget.background': widget,
    'diffEditor.unchangedRegionBackground': c.raised,
    'diffEditor.unchangedRegionForeground': c.muted,
  }
}
