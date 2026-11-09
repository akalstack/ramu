import {
  Box,
  Braces,
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileDiff,
  FileImage,
  FileKey,
  FileLock,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Presentation,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react'
import { fileIconStyle, type FileIconName, type FileIconTone } from '@ramu/shared/workspace/fileIcons'

const ICONS: Record<FileIconName, LucideIcon> = {
  Box,
  Braces,
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileDiff,
  FileImage,
  FileKey,
  FileLock,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Presentation,
  SquareTerminal,
}
const TONE: Record<FileIconTone, string> = {
  ok: 'text-ok',
  brand: 'text-brand',
  warn: 'text-warn',
  bad: 'text-bad',
  muted: 'text-muted-foreground',
}

/** The tint class for a file's icon, for icons drawn elsewhere (such as a diff row). */
export const fileToneClass = (path: string) => TONE[fileIconStyle(path).tone]

/** A file's icon by name or extension; the phone draws the same one (`@ramu/shared/workspace/fileIcons`). */
export function FileIcon({ path, size = 14, className = '' }: { path: string; size?: number; className?: string }) {
  const { icon, tone, logo } = fileIconStyle(path)
  const classes = `${className} ${TONE[tone]}`.trim()
  // The padded box matches Lucide's inset so logos and outline icons line up in the same row.
  if (logo)
    return (
      <svg width={size} height={size} viewBox="-2 -2 28 28" className={classes} aria-hidden="true">
        <path d={logo.path} fill={logo.color ?? 'currentColor'} />
      </svg>
    )
  const Icon = ICONS[icon]
  return <Icon size={size} className={classes} aria-hidden="true" />
}
