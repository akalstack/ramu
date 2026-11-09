import { FILE_LOGO_PATHS, type FileLogoName } from './fileLogos'

// Which icon and tint a file gets, by name or extension. Languages and tools with a known mark get their logo in its
// color; everything else gets a Lucide icon in a theme tone. Desktop and mobile both draw from this, so a file looks
// the same in Explorer, the composer, chat references and tool rows on both.

export type FileIconName =
  | 'Box'
  | 'Braces'
  | 'Database'
  | 'File'
  | 'FileArchive'
  | 'FileAudio'
  | 'FileCode'
  | 'FileCog'
  | 'FileDiff'
  | 'FileImage'
  | 'FileKey'
  | 'FileLock'
  | 'FileSpreadsheet'
  | 'FileText'
  | 'FileType'
  | 'FileVideo'
  | 'Presentation'
  | 'SquareTerminal'
export type FileIconTone = 'ok' | 'brand' | 'warn' | 'bad' | 'muted'
export interface FileLogo {
  /** A filled path in a 24×24 box. */
  path: string
  /** A fixed color, chosen to read on light and dark; absent means the tone's theme color. */
  color?: string
}
export interface FileIconStyle {
  icon: FileIconName
  tone: FileIconTone
  logo?: FileLogo
}

const style = (icon: FileIconName, tone: FileIconTone): FileIconStyle => ({ icon, tone })
const logo = (name: FileLogoName, color: string | undefined, tone: FileIconTone = 'brand'): FileIconStyle => ({
  icon: 'FileCode',
  tone,
  logo: color ? { path: FILE_LOGO_PATHS[name], color } : { path: FILE_LOGO_PATHS[name] },
})
const set = (exts: string, value: FileIconStyle) => exts.split(' ').map((ext) => [ext, value] as const)
const CODE = style('FileCode', 'brand')
// Shell scripts and JSON read better as a terminal window and braces than as their logos, which blur at icon size.
const SHELL = style('SquareTerminal', 'ok'),
  JSON_ICON = style('Braces', 'warn')
const TYPESCRIPT = logo('typescript', '#3178C6'),
  MARKDOWN = logo('markdown', undefined, 'muted'),
  DOCKER = logo('docker', '#2496ED'),
  GIT = logo('git', '#F05032', 'muted'),
  NODE = logo('node', '#5FA04E', 'ok')

const BY_EXT = new Map<string, FileIconStyle>([
  ...set('ts mts cts', TYPESCRIPT),
  ...set('tsx jsx', logo('react', '#149ECA')),
  ...set('js mjs cjs', logo('javascript', '#E5C100', 'warn')),
  ...set('py pyi', logo('python', '#3776AB')),
  ...set('go', logo('go', '#00ADD8')),
  ...set('rs', logo('rust', '#CE422B', 'bad')),
  ...set('java', logo('java', '#E76F00', 'warn')),
  ...set('kt kts', logo('kotlin', '#7F52FF')),
  ...set('swift', logo('swift', '#F05138', 'bad')),
  ...set('c h', logo('c', '#659AD2')),
  ...set('cc cpp cxx hpp hh hxx', logo('cpp', '#3D7FC1')),
  ...set('php', logo('php', '#777BB4')),
  ...set('rb', logo('ruby', '#CC342D', 'bad')),
  ...set('dart', logo('dart', '#2B9BE0')),
  ...set('vue', logo('vue', '#4FC08D', 'ok')),
  ...set('svelte', logo('svelte', '#FF3E00', 'bad')),
  ...set('astro', logo('astro', '#BC52EE')),
  ...set('graphql gql', logo('graphql', '#E10098')),
  ...set('html htm', logo('html', '#E34F26', 'warn')),
  ...set('css', logo('css', '#2D8CDB')),
  ...set('scss sass', logo('sass', '#CC6699')),
  ...set('md markdown mdx', MARKDOWN),
  ...set('json jsonc json5', JSON_ICON),
  ...set('yaml yml', logo('yaml', '#CB171E', 'bad')),
  ...set('toml', logo('toml', '#C0582F', 'warn')),
  ...set('sh bash zsh fish ps1 psm1 bat cmd', SHELL),
  ...set('prisma', logo('prisma', '#5A67D8')),
  ...set('zig', logo('zig', '#F7A41D', 'warn')),
  ...set('tf tfvars hcl', logo('terraform', '#844FBA')),
  ...set('db sqlite sqlite3', logo('sqlite', '#0F80CC')),
  ...set('lua cs scala sql proto less hs ex exs erl clj cljs pl pm r groovy gradle nix m mm vim cmake http', CODE),
  ...set('diff patch', style('FileDiff', 'brand')),
  ...set('env', style('FileKey', 'warn')),
  ...set('conf cfg', style('FileCog', 'muted')),
  ...set('png jpg jpeg gif webp avif bmp ico svg heic tiff', style('FileImage', 'ok')),
  ...set('mp4 webm mov mkv avi', style('FileVideo', 'bad')),
  ...set('mp3 wav ogg m4a flac aac', style('FileAudio', 'bad')),
  ...set('pdf', style('FileType', 'bad')),
  ...set('xml', style('FileCode', 'warn')),
  ...set('ini plist', style('FileCog', 'muted')),
  ...set('txt rst log', style('FileText', 'muted')),
  ...set('csv tsv xls xlsx ods', style('FileSpreadsheet', 'ok')),
  ...set('ppt pptx key odp', style('Presentation', 'warn')),
  ...set('doc docx rtf odt', style('FileText', 'brand')),
  ...set('zip tar gz tgz bz2 xz 7z rar', style('FileArchive', 'warn')),
  ...set('lock', style('FileLock', 'muted')),
  ...set('pem crt cer p12', style('FileKey', 'warn')),
  ...set('wasm bin exe dll so dylib', style('Box', 'muted')),
  ...set('ttf otf woff woff2', style('FileType', 'muted')),
])
const BY_NAME = new Map<string, FileIconStyle>([
  ['package.json', NODE],
  ['.nvmrc', NODE],
  ['.node-version', NODE],
  ['package-lock.json', logo('npm', '#CB3837', 'bad')],
  ['.npmrc', logo('npm', '#CB3837', 'bad')],
  ['pnpm-lock.yaml', logo('pnpm', '#F69220', 'warn')],
  ['pnpm-workspace.yaml', logo('pnpm', '#F69220', 'warn')],
  ['yarn.lock', logo('yarn', '#2C8EBF')],
  ['.yarnrc.yml', logo('yarn', '#2C8EBF')],
  ['dockerfile', DOCKER],
  ['.dockerignore', DOCKER],
  ['docker-compose.yml', DOCKER],
  ['docker-compose.yaml', DOCKER],
  ['compose.yml', DOCKER],
  ['compose.yaml', DOCKER],
  ['makefile', style('FileCog', 'warn')],
  ['.gitignore', GIT],
  ['.gitattributes', GIT],
  ['.gitmodules', GIT],
  ['license', style('FileText', 'muted')],
])
// Tool configs by name prefix, before the generic config icon.
const BY_PREFIX: [RegExp, FileIconStyle][] = [
  [/^tsconfig(\..+)?\.json$/, TYPESCRIPT],
  [/^(vite|vitest)\.config\./, logo('vite', '#646CFF')],
  [/^tailwind\.config\./, logo('tailwind', '#06B6D4')],
  [/^(eslint\.config\.|\.eslintrc)/, logo('eslint', '#8080F2')],
  [/^(prettier\.config\.|\.prettierrc)/, logo('prettier', '#E0A526', 'warn')],
  [/^dockerfile\./, DOCKER],
]

/** Icon and tint for a file, chosen by its name or extension. */
export function fileIconStyle(path: string): FileIconStyle {
  const name = (path.split('/').at(-1) ?? path).toLowerCase()
  const exact = BY_NAME.get(name)
  if (exact) return exact
  const prefixed = BY_PREFIX.find(([pattern]) => pattern.test(name))
  if (prefixed) return prefixed[1]
  if (/^\.env(\.|$)/.test(name)) return style('FileKey', 'warn')
  if (/\.(config|rc)\.[a-z]+$|^\.[a-z]+rc(\.[a-z]+)?$/.test(name)) return style('FileCog', 'muted')
  return BY_EXT.get(name.slice(name.lastIndexOf('.') + 1)) ?? style('File', 'muted')
}
