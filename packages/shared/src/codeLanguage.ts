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
