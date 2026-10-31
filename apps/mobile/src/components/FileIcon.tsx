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
} from 'lucide-react-native'
import { fileIconStyle, type FileIconName } from '@ramu/shared/workspace/fileIcons'
import { useTheme } from '../theme'
import type { Icon } from './ui'

const ICONS: Record<FileIconName, Icon> = {
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

/** A file's icon by name or extension, the same one the desktop draws. */
export function FileIcon({ path, size = 16 }: { path: string; size?: number }) {
  const { c } = useTheme()
  const { icon, tone } = fileIconStyle(path)
  const I = ICONS[icon]
  const color = { ok: c.ok, brand: c.accent, warn: c.warn, bad: c.bad, muted: c.muted }[tone]
  return <I size={size} color={color} strokeWidth={1.8} />
}
