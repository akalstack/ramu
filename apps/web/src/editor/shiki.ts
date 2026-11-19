// TextMate highlighting for Monaco through Shiki's official integration (@shikijs/monaco).
// Monarch grammars keep serving language configuration (brackets, comments) and any language Shiki lacks.
import { shikiToMonaco } from '@shikijs/monaco'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { bundledLanguages } from 'shiki/langs'
import { bundledThemes } from 'shiki/themes'
import * as monacoApi from 'monaco-editor/editor/editor.api.js'
import { RAMU_EDITOR_COLORS, RAMU_EDITOR_COLORS_LIGHT } from './editorTheme'
import { monarchReady } from './monacoLanguages'

type Monaco = Parameters<typeof shikiToMonaco>[1]

/** Monaco language ids that Shiki names differently. */
const SHIKI_LANGUAGE: Record<string, string> = {
  typescriptreact: 'tsx',
  javascriptreact: 'jsx',
  mysql: 'sql',
  pgsql: 'sql',
  redshift: 'sql',
  restructuredtext: 'rst',
  freemarker2: 'ftl',
}

/** Languages worth having ready before the first file opens; markdown also embeds them in fences. */
const WARM = [
  'typescript',
  'typescriptreact',
  'javascript',
  'javascriptreact',
  'json',
  'css',
  'html',
  'markdown',
  'shellscript',
  'yaml',
]

let highlighter: Promise<HighlighterCore> | undefined
const requested = new Map<string, Promise<void>>()
// Each install re-registers every loaded language, so installs run one at a time.
let chain: Promise<void> = Promise.resolve()

const monaco = monacoApi as unknown as Monaco
// shikiToMonaco wraps these; the originals are put back before every re-run so wrappers don't stack.
const { setTheme, create } = monaco.editor

/**
 * @shikijs/monaco hands Monaco only a token's color and maps it back to the first theme scope using that color, so a
 * scope Monaco resolves differently (one inside a larger selector, or shadowed by a broader rule) recolors every token
 * sharing the color. One synthetic token per color and font style makes that round trip exact.
 */
function monacoRules(theme: { tokenColors?: { settings?: { foreground?: string; fontStyle?: string } }[] }) {
  const rules = new Map<string, { token: string; foreground?: string; fontStyle?: string }>()
  for (const { settings } of theme.tokenColors ?? []) {
    const foreground = settings?.foreground?.replace('#', '').toLowerCase()
    if (!foreground) continue
    const fontStyle = settings?.fontStyle ?? ''
    const token = `shiki-${foreground}${fontStyle ? `-${fontStyle.trim().replace(/\s+/g, '-')}` : ''}`
    rules.set(token, { token, foreground, ...(fontStyle ? { fontStyle } : {}) })
  }
  return [...rules.values()]
}

/** Oniguruma (WASM) tokenizes exactly as VS Code does; the JavaScript engine covers a host whose CSP forbids WASM. */
async function engine() {
  try {
    return await createOnigurumaEngine(import('shiki/wasm'))
  } catch {
    return createJavaScriptRegexEngine({ forgiving: true })
  }
}

function createHighlighter() {
  return (highlighter ??= (async () => {
    // `rules` is not in Shiki's theme type, but @shikijs/monaco reads it when present.
    const ramu = async (source: 'github-dark-default' | 'github-light-default', name: string, colors: object) => {
      const theme = (await bundledThemes[source]()).default
      // Only the token colors come from GitHub's themes; the surfaces are Ramu's own.
      return { ...theme, name, colors, rules: monacoRules(theme) } as typeof theme
    }
    return createHighlighterCore({
      themes: [
        await ramu('github-dark-default', 'ramu', RAMU_EDITOR_COLORS),
        await ramu('github-light-default', 'ramu-light', RAMU_EDITOR_COLORS_LIGHT),
      ],
      langs: [],
      engine: await engine(),
    })
  })())
}

async function install(monacoLanguage: string, language: string) {
  const shiki = await createHighlighter()
  // Monaco installs its Monarch tokenizer when the language first loads; ours has to be the one left standing.
  await monarchReady(monacoLanguage)
  const grammars = (await bundledLanguages[language as keyof typeof bundledLanguages]()).default
  // @shikijs/monaco only registers a language whose Shiki name or alias is the Monaco id.
  await shiki.loadLanguage(
    grammars.map((grammar) =>
      grammar.name === language && monacoLanguage !== language
        ? { ...grammar, aliases: [...(grammar.aliases ?? []), monacoLanguage] }
        : grammar,
    ),
  )
  monaco.editor.setTheme = setTheme
  monaco.editor.create = create
  shikiToMonaco(shiki, monaco)
}

/** Registers an editor theme with GitHub's token colors and the given workbench colors, ready for `setTheme`. */
export async function defineEditorTheme(name: string, base: 'dark' | 'light', colors: Record<string, string>) {
  const shiki = await createHighlighter()
  const theme = (await bundledThemes[base === 'dark' ? 'github-dark-default' : 'github-light-default']()).default
  await shiki.loadTheme({ ...theme, name, colors, rules: monacoRules(theme) } as typeof theme)
  chain = chain.then(() => {
    monaco.editor.setTheme = setTheme
    monaco.editor.create = create
    shikiToMonaco(shiki, monaco)
  })
  await chain
}

/** Resolves once Shiki colors the Monaco language; resolves anyway when Shiki has no grammar for it. */
export function loadShikiLanguage(monacoLanguage: string): Promise<void> {
  const language = SHIKI_LANGUAGE[monacoLanguage] ?? monacoLanguage
  if (!(language in bundledLanguages)) return Promise.resolve()
  let installed = requested.get(monacoLanguage)
  if (!installed) {
    installed = chain = chain
      .then(() => install(monacoLanguage, language))
      .catch(() => void requested.delete(monacoLanguage))
    requested.set(monacoLanguage, installed)
  }
  return installed
}

export function setupShiki() {
  for (const { id } of monaco.languages.getLanguages())
    monaco.languages.onLanguage(id, () => void loadShikiLanguage(id))
  const warm = () => WARM.forEach((language) => void loadShikiLanguage(language))
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm)
  else setTimeout(warm, 200)
}
