import { Box, Braces, Database, File, FileArchive, FileAudio, FileCode, FileCog, FileImage, FileJson, FileKey, FileLock, FileSpreadsheet, FileTerminal, FileText, FileType, FileVideo, Globe, Package, Palette, Presentation, type LucideIcon } from 'lucide-react'

type Style = [icon: LucideIcon, color: string]
const set = (exts: string, style: Style) => exts.split(' ').map((ext) => [ext, style] as const)
const IMAGE: Style = [FileImage, 'text-ok'], CODE: Style = [FileCode, 'text-brand'], DATA: Style = [FileJson, 'text-warn'], DOC: Style = [FileText, 'text-muted-foreground']

const BY_EXT = new Map<string, Style>([
  ...set('png jpg jpeg gif webp avif bmp ico svg heic tiff', IMAGE),
  ...set('mp4 webm mov mkv avi', [FileVideo, 'text-bad']),
  ...set('mp3 wav ogg m4a flac aac', [FileAudio, 'text-bad']),
  ...set('pdf', [FileType, 'text-bad']),
  ...set('ts tsx mts cts js jsx mjs cjs py rb go rs java kt swift c h cc cpp hpp cs php lua dart scala vue svelte astro sql graphql proto', CODE),
  ...set('json jsonc json5 yaml yml toml xml ini env plist', DATA),
  ...set('html htm', [Globe, 'text-warn']),
  ...set('css scss sass less', [Palette, 'text-brand']),
  ...set('md mdx markdown txt rst log', DOC),
  ...set('csv tsv xls xlsx ods', [FileSpreadsheet, 'text-ok']),
  ...set('ppt pptx key odp', [Presentation, 'text-warn']),
  ...set('doc docx rtf odt', [FileText, 'text-brand']),
  ...set('zip tar gz tgz bz2 xz 7z rar', [FileArchive, 'text-warn']),
  ...set('sh bash zsh fish ps1 bat cmd', [FileTerminal, 'text-ok']),
  ...set('lock', [FileLock, 'text-muted-foreground']),
  ...set('pem key crt cer p12', [FileKey, 'text-warn']),
  ...set('db sqlite sqlite3', [Database, 'text-brand']),
  ...set('wasm bin exe dll so dylib', [Box, 'text-muted-foreground']),
  ...set('ttf otf woff woff2', [FileType, 'text-muted-foreground']),
])
const BY_NAME = new Map<string, Style>([
  ['package.json', [Package, 'text-ok']], ['pnpm-lock.yaml', [FileLock, 'text-muted-foreground']], ['package-lock.json', [FileLock, 'text-muted-foreground']], ['yarn.lock', [FileLock, 'text-muted-foreground']],
  ['dockerfile', [Box, 'text-brand']], ['makefile', [FileTerminal, 'text-ok']], ['.gitignore', [FileCog, 'text-muted-foreground']], ['.gitattributes', [FileCog, 'text-muted-foreground']],
  ['.env', [FileKey, 'text-warn']], ['license', [FileText, 'text-muted-foreground']], ['readme.md', [Braces, 'text-brand']],
])

/** Icon (and tint) for a file, chosen by its name or extension. */
export function fileStyle(path: string): Style {
  const name = (path.split('/').at(-1) ?? path).toLowerCase()
  const exact = BY_NAME.get(name)
  if (exact) return exact
  if (/^\.env(\.|$)/.test(name)) return [FileKey, 'text-warn']
  if (/\.(config|rc)\.[a-z]+$|^\.[a-z]+rc(\.[a-z]+)?$/.test(name)) return [FileCog, 'text-muted-foreground']
  return BY_EXT.get(name.slice(name.lastIndexOf('.') + 1)) ?? [File, 'text-muted-foreground']
}

export function FileIcon({ path, size = 14, className = '' }: { path: string; size?: number; className?: string }) {
  const [Icon, color] = fileStyle(path)
  return <Icon size={size} className={`${className} ${color}`.trim()} aria-hidden="true" />
}
