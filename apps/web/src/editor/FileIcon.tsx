import {
  Box,
  Braces,
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileKey,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideo,
  Globe,
  Package,
  Palette,
  Presentation,
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
  FileImage,
  FileJson,
  FileKey,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideo,
  Globe,
  Package,
  Palette,
  Presentation,
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
  const { icon, tone } = fileIconStyle(path)
  const Icon = ICONS[icon]
  return <Icon size={size} className={`${className} ${TONE[tone]}`.trim()} aria-hidden="true" />
}
