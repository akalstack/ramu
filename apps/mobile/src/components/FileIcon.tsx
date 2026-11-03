import {
  Box,
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
  Presentation,
} from 'lucide-react-native'
import Svg, { Path } from 'react-native-svg'
import { fileIconStyle, type FileIconName } from '@ramu/shared/workspace/fileIcons'
import { useTheme } from '../theme'
import type { Icon } from './ui'

const ICONS: Record<FileIconName, Icon> = {
  Box,
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
  Presentation,
}

/** A file's icon by name or extension, the same one the desktop draws. */
export function FileIcon({ path, size = 16 }: { path: string; size?: number }) {
  const { c } = useTheme()
  const { icon, tone, logo } = fileIconStyle(path)
  const color = { ok: c.ok, brand: c.accent, warn: c.warn, bad: c.bad, muted: c.muted }[tone]
  // The padded box matches Lucide's inset so logos and outline icons line up in the same row.
  if (logo)
    return (
      <Svg width={size} height={size} viewBox="-2 -2 28 28">
        <Path d={logo.path} fill={logo.color ?? color} />
      </Svg>
    )
  const I = ICONS[icon]
  return <I size={size} color={color} strokeWidth={1.8} />
}
