const extensions: Record<string, string> = {
  javascript: 'js',
  js: 'js',
  jsx: 'jsx',
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  python: 'py',
  py: 'py',
  shell: 'sh',
  bash: 'sh',
  sh: 'sh',
  zsh: 'sh',
  // Terminal sessions are fenced under these names too; they read and highlight as shell.
  console: 'sh',
  terminal: 'sh',
  shellscript: 'sh',
  'shell-session': 'sh',
  json: 'json',
  html: 'html',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  yaml: 'yaml',
  yml: 'yaml',
  markdown: 'md',
  md: 'md',
  sql: 'sql',
  rust: 'rs',
  rs: 'rs',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  cs: 'cs',
  ruby: 'rb',
  rb: 'rb',
  php: 'php',
  swift: 'swift',
  kotlin: 'kt',
  kt: 'kt',
  text: 'txt',
  plaintext: 'txt',
  txt: 'txt',
}

/** Prefer the fence's language; infer only recognizable syntax in unlabeled blocks. */
export function codeLanguage(source: string, hint?: string): string {
  if (hint) {
    const name = hint.toLowerCase().trim()
    const extension = name.split(/[./\\]/).at(-1)!
    return extensions[name] ?? extensions[extension] ?? name
  }
  const text = source.trim()
  if (!text) return 'txt'
  try {
    const value: unknown = JSON.parse(text)
    if (value !== null && typeof value === 'object') return 'json'
  } catch {
    /* Other code. */
  }
  const typed = /\b(?:interface|type)\s+\w+\s*(?:[={<])|\b(?:const|let|function)\s+\w+[^\n]*:\s*\w+/.test(text)
  const jsx = /<\/?[A-Z][\w.]*(?:\s|>|\/)|\bclassName\s*=|\{[^\n]*\}\s*<\//.test(text)
  if (jsx) return typed ? 'tsx' : 'jsx'
  if (typed) return 'ts'
  if (/^\s*(?:from\s+\w[\w.]*\s+import\s|def\s+\w+\(|class\s+\w+.*:|import\s+\w[\w.]*\s*$)/m.test(text)) return 'py'
  if (/^#!.*\b(?:bash|sh|zsh)\b|^\s*(?:npm|pnpm|yarn|git|curl|sudo|echo|export)\s+/m.test(text)) return 'sh'
  if (/\b(?:const|let|var)\s+\w+\s*=|\b(?:function\s+\w+|console\.log)\s*\(|=>/.test(text)) return 'js'
  if (/<!doctype\s+html|<\/?(?:html|div|body|head|p|span)\b/i.test(text)) return 'html'
  if (/^[.#]?[\w\s.:#>,-]+\{\s*[\w-]+\s*:/m.test(text)) return 'css'
  if (/\b(?:SELECT\s+.+\s+FROM|CREATE\s+TABLE|INSERT\s+INTO|UPDATE\s+\w+\s+SET)\b/i.test(text)) return 'sql'
  if (/^\s*(?:pub\s+)?fn\s+\w+\s*\(|\b(?:impl|use)\s+\w+::/m.test(text)) return 'rs'
  if (/^package\s+\w+|^func\s+\w+\(/m.test(text)) return 'go'
  return 'txt'
}

const LANGUAGE_NAMES: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  jsx: 'JSX',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  json: 'JSON',
  jsonc: 'JSON',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sql: 'SQL',
  rs: 'Rust',
  go: 'Go',
  md: 'Markdown',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  txt: 'Text',
  diff: 'Diff',
  swift: 'Swift',
  kt: 'Kotlin',
  java: 'Java',
  rb: 'Ruby',
  c: 'C',
  cpp: 'C++',
  cs: 'C#',
  php: 'PHP',
  xml: 'XML',
  dockerfile: 'Dockerfile',
}

/** "TypeScript" for `ts`; an unknown extension reads as itself in capitals. */
export const languageName = (extension: string) => LANGUAGE_NAMES[extension.toLowerCase()] ?? extension.toUpperCase()

/** Languages whose files go by a name, not an extension, so the icon matches the explorer's for that file. */
const NAMED_FILES: Record<string, string> = { dockerfile: 'Dockerfile', makefile: 'Makefile' }

const PATH = /^(?:~|\.{1,2}|[A-Za-z]:)?[\\/]?(?:[\w.@+~-]+[\\/])+[\w.@+~-]*$/

/**
 * What a code block's header says: the file it names (` ```src/app.ts `), "Path" for a lone file path, or the language.
 * `icon` is a file name whose extension picks the file icon.
 */
export function codeBlockLabel(source: string, hint?: string): { label: string; icon: string; title?: string } {
  const named = hint?.trim()
  if (named && /[./\\]/.test(named) && /\.\w+$/.test(named)) {
    return { label: named.split(/[\\/]/).at(-1)!, icon: named, title: named }
  }
  const text = source.trim()
  if (!text.includes('\n') && !/\s/.test(text) && PATH.test(text))
    return { label: 'Path', icon: text.split(/[\\/]/).at(-1) || 'folder' }
  const extension = codeLanguage(source, hint)
  // Files known by name rather than extension take the explorer's icon for that name.
  const byName = NAMED_FILES[extension]
  return { label: languageName(extension), icon: byName ?? `file.${extension}` }
}

/** Drops the indentation every line shares, and blank lines at either end, as a list item's fenced block carries. */
export function dedentCode(source: string): string {
  const lines = source.split('\n')
  while (lines.length && !lines[0]!.trim()) lines.shift()
  while (lines.length && !lines.at(-1)!.trim()) lines.pop()
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length))
  return Number.isFinite(indent) && indent > 0 ? lines.map((line) => line.slice(indent)).join('\n') : lines.join('\n')
}
