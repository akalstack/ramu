// Syntax highlighting for chat code, files and diffs. Pure (no React), so it is unit-tested in Node.
import hljs from 'highlight.js/lib/core'
import { codeLanguage } from '@ramu/shared/codeLanguage'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

// The desktop colours code with Monaco, which needs a DOM; highlight.js is the pure-JS equivalent, with a VS Code palette.
const grammars = { bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, markdown, php, python, ruby, rust, scss, sql, swift, typescript, xml, yaml }
for (const [name, grammar] of Object.entries(grammars)) hljs.registerLanguage(name, grammar)

/** `codeLanguage` names (a fence label or a file extension) to highlight.js grammars. */
const GRAMMAR: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  py: 'python', sh: 'bash', zsh: 'bash', bash: 'bash', json: 'json', jsonc: 'json', html: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  css: 'css', scss: 'scss', yaml: 'yaml', yml: 'yaml', md: 'markdown', sql: 'sql', rs: 'rust', go: 'go', java: 'java', c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin', kts: 'kotlin',
  diff: 'diff', patch: 'diff', toml: 'ini', ini: 'ini', env: 'ini', dockerfile: 'dockerfile',
}
/** Above this, code stays plain so a huge log or file never stalls the phone. */
const MAX_HIGHLIGHT = 100_000

export type Token = { text: string; scope?: string }

/** The grammar for a fenced block (`hint` is its label) or a file (`hint` is its path). */
export function grammarFor(source: string, hint?: string): string | undefined {
  const fromPath = hint && /[./]/.test(hint) ? hint.split('/').at(-1)!.toLowerCase() : undefined
  if (fromPath === 'dockerfile') return 'dockerfile'
  const language = codeLanguage(source, fromPath ? fromPath.split('.').at(-1) : hint)
  return GRAMMAR[language] ?? (hljs.getLanguage(language) ? language : undefined)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" }
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_, name: string) => ENTITIES[name]!)

/** Highlighted source split into lines of tokens; `null` when it should stay plain (no grammar, or too large). */
export function highlightLines(source: string, grammar: string | undefined): Token[][] | null {
  if (!grammar || source.length > MAX_HIGHLIGHT || !hljs.getLanguage(grammar)) return null
  let html: string
  try { html = hljs.highlight(source, { language: grammar, ignoreIllegals: true }).value } catch { return null }
  const lines: Token[][] = [[]]
  const scopes: string[] = []
  for (const match of html.matchAll(/<span class="([^"]+)">|<\/span>|([^<]+)/g)) {
    if (match[1]) { scopes.push(match[1]); continue }
    if (!match[2]) { scopes.pop(); continue }
    const scope = scopes.at(-1)
    decode(match[2]).split('\n').forEach((text, index) => {
      if (index) lines.push([])
      if (text) lines.at(-1)!.push({ text, scope })
    })
  }
  return lines
}

