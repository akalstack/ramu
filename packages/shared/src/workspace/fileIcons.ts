// Which icon and tint a file gets, by name or extension. Desktop and mobile draw the named Lucide icon with the tone's
// theme color, so a file looks the same in Explorer, chat references and tool rows on both.

export type FileIconName =
  | 'Box'
  | 'Braces'
  | 'Database'
  | 'File'
  | 'FileArchive'
  | 'FileAudio'
  | 'FileCode'
  | 'FileCog'
  | 'FileImage'
  | 'FileJson'
  | 'FileKey'
  | 'FileLock'
  | 'FileSpreadsheet'
  | 'FileTerminal'
  | 'FileText'
  | 'FileType'
  | 'FileVideo'
  | 'Globe'
  | 'Package'
  | 'Palette'
  | 'Presentation'
export type FileIconTone = 'ok' | 'brand' | 'warn' | 'bad' | 'muted'
export interface FileIconStyle {
  icon: FileIconName
  tone: FileIconTone
}

const style = (icon: FileIconName, tone: FileIconTone): FileIconStyle => ({ icon, tone })
const set = (exts: string, value: FileIconStyle) => exts.split(' ').map((ext) => [ext, value] as const)
const IMAGE = style('FileImage', 'ok'),
  CODE = style('FileCode', 'brand'),
  DATA = style('FileJson', 'warn'),
  DOC = style('FileText', 'muted')

const BY_EXT = new Map<string, FileIconStyle>([
  ...set('png jpg jpeg gif webp avif bmp ico svg heic tiff', IMAGE),
  ...set('mp4 webm mov mkv avi', style('FileVideo', 'bad')),
  ...set('mp3 wav ogg m4a flac aac', style('FileAudio', 'bad')),
  ...set('pdf', style('FileType', 'bad')),
  ...set(
    'ts tsx mts cts js jsx mjs cjs py rb go rs java kt swift c h cc cpp hpp cs php lua dart scala vue svelte astro sql graphql proto',
    CODE,
  ),
  ...set('json jsonc json5 yaml yml toml xml ini env plist', DATA),
  ...set('html htm', style('Globe', 'warn')),
  ...set('css scss sass less', style('Palette', 'brand')),
  ...set('md mdx markdown txt rst log', DOC),
  ...set('csv tsv xls xlsx ods', style('FileSpreadsheet', 'ok')),
  ...set('ppt pptx key odp', style('Presentation', 'warn')),
  ...set('doc docx rtf odt', style('FileText', 'brand')),
  ...set('zip tar gz tgz bz2 xz 7z rar', style('FileArchive', 'warn')),
  ...set('sh bash zsh fish ps1 bat cmd', style('FileTerminal', 'ok')),
  ...set('lock', style('FileLock', 'muted')),
  ...set('pem key crt cer p12', style('FileKey', 'warn')),
  ...set('db sqlite sqlite3', style('Database', 'brand')),
  ...set('wasm bin exe dll so dylib', style('Box', 'muted')),
  ...set('ttf otf woff woff2', style('FileType', 'muted')),
])
const BY_NAME = new Map<string, FileIconStyle>([
  ['package.json', style('Package', 'ok')],
  ['pnpm-lock.yaml', style('FileLock', 'muted')],
  ['package-lock.json', style('FileLock', 'muted')],
  ['yarn.lock', style('FileLock', 'muted')],
  ['dockerfile', style('Box', 'brand')],
  ['makefile', style('FileTerminal', 'ok')],
  ['.gitignore', style('FileCog', 'muted')],
  ['.gitattributes', style('FileCog', 'muted')],
  ['.env', style('FileKey', 'warn')],
  ['license', style('FileText', 'muted')],
  ['readme.md', style('Braces', 'brand')],
])

/** Icon and tint for a file, chosen by its name or extension. */
export function fileIconStyle(path: string): FileIconStyle {
  const name = (path.split('/').at(-1) ?? path).toLowerCase()
  const exact = BY_NAME.get(name)
  if (exact) return exact
  if (/^\.env(\.|$)/.test(name)) return style('FileKey', 'warn')
  if (/\.(config|rc)\.[a-z]+$|^\.[a-z]+rc(\.[a-z]+)?$/.test(name)) return style('FileCog', 'muted')
  return BY_EXT.get(name.slice(name.lastIndexOf('.') + 1)) ?? style('File', 'muted')
}
