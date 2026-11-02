import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(import.meta.dirname, '../src')

/** Files that legitimately define or mirror colors; everything else takes its colors from the theme tokens. */
const TOKEN_FILES = new Set([
  'styles.css',
  'components/theme-recovery-button.css', // Fixed recovery palette, independent of candidate tokens.
  'editor/editorTheme.ts', // workbench palettes for Monaco, which cannot read CSS variables
  'theme/terminalTheme.ts', // xterm palettes, for the same reason
  'settings/AppSettings.tsx', // accent choices of Ramu Default
  'Brand.tsx', // logo artwork
])

/**
 * Literal colors that stay on purpose: text on a saturated fill, brand marks, status-dot neutrals and shadows. A new
 * color literal in a component should be a theme token (styles.css) instead; add it here only with a reason.
 */
const ALLOWED = new Set([
  'chat.css #0005', // shadow
  'chat.css #ffffff2e', // highlight on the primary send button
  'composer/ComposerSuggestions.tsx #0008', // shadow
  'models/ModelBar.tsx #fff', // slider thumb
  'components/step-slider.tsx bg-white', // slider thumb
  'models/ModelPicker.tsx #f0a63c', // favorite star
  'settings/AppearanceSettings.tsx #0a84ff', // accent swatches
  'settings/AppearanceSettings.tsx #7652d4',
  'settings/AppearanceSettings.tsx #087f7b',
  'views/MediaFileView.tsx bg-white', // a document's own page background
  'workspace/TaskPane.tsx #0003', // shadow
  'interactive/InteractiveContent.tsx #131315', // fallbacks when a token is unreadable
  'interactive/InteractiveContent.tsx #eeeef0',
  'interactive/InteractiveContent.tsx #a78bfa',
  'interactive/InteractiveContent.tsx #a1a1aa',
])

const LITERAL = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b(?![\w-])|\bbg-white\b|\btext-white\b/g

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== 'ui') yield* sources(path)
    } else if (/\.(tsx?|css)$/.test(name)) yield path
  }
}

describe('theme tokens', () => {
  it('keeps color literals out of components', () => {
    const found: string[] = []
    for (const path of sources(SRC)) {
      const file = relative(SRC, path)
      if (TOKEN_FILES.has(file)) continue
      for (const match of new Set(readFileSync(path, 'utf8').match(LITERAL) ?? []))
        if (!ALLOWED.has(`${file} ${match}`)) found.push(`${file} ${match}`)
    }
    expect(found).toEqual([])
  })
})
