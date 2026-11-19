import {
  AppWindow,
  Clapperboard,
  FileText,
  Frame,
  LayoutDashboard,
  Presentation,
  Workflow,
  type LucideIcon,
} from 'lucide-react-native'
import type { ArtifactKind } from '@ramu/shared/artifacts'
import type { HostExportFormat, KindExportFormat } from '@ramu/shared/interactiveExport'
import { useSay } from '../i18n'

const KIND_ICONS: Record<ArtifactKind, LucideIcon> = {
  app: AppWindow,
  doc: FileText,
  diagram: Workflow,
  slides: Presentation,
  dashboard: LayoutDashboard,
  design: Frame,
  motion: Clapperboard,
}
const KIND_LABELS: Record<ArtifactKind, string> = {
  app: 'App',
  doc: 'Doc',
  diagram: 'Diagram',
  slides: 'Slides',
  dashboard: 'Dashboard',
  design: 'Design',
  motion: 'Motion',
}

/** English copy keys for a kind's name and for sharing each of its exports, translated with say(). */
export const kindLabel = (kind: ArtifactKind) => KIND_LABELS[kind]
export const kindIcon = (kind: ArtifactKind) => KIND_ICONS[kind]
export const SHARE_LABELS: Record<KindExportFormat, string> = {
  markdown: 'Share Markdown',
  html: 'Share HTML',
  svg: 'Share SVG',
  mermaid: 'Share Mermaid',
  csv: 'Share CSV',
}
const HOST_SHARE_LABELS: Record<HostExportFormat, string> = {
  pptx: 'Share PowerPoint',
  pdf: 'Share PDF',
  png: 'Share slide images',
  docx: 'Share Word',
  webm: 'Share WebM video',
  mp4: 'Share MP4 video',
}
/** An export the host makes and the phone hands to the share sheet once it arrives; a diagram's PNG is one image. */
export const hostShareLabel = (format: HostExportFormat, kind: ArtifactKind) =>
  format === 'png' && kind === 'design'
    ? 'Share frame images'
    : format === 'png' && kind === 'motion'
      ? 'Share poster image'
      : format === 'png' && kind !== 'slides'
        ? 'Share PNG'
        : HOST_SHARE_LABELS[format]

/** The small mark rows and cards show for what an artifact is, named for screen readers. */
export function ArtifactKindMark({ kind, size = 14, color }: { kind: ArtifactKind; size?: number; color: string }) {
  const say = useSay()
  const Icon = KIND_ICONS[kind]
  return (
    <Icon size={size} color={color} accessible accessibilityRole="image" accessibilityLabel={say(kindLabel(kind))} />
  )
}
