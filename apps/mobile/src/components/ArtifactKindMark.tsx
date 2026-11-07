import { AppWindow, FileText, Presentation, Workflow, type LucideIcon } from 'lucide-react-native'
import type { ArtifactKind } from '@ramu/shared/artifacts'
import type { HostExportFormat, KindExportFormat } from '@ramu/shared/interactiveExport'
import { useSay } from '../i18n'

const KIND_ICONS: Record<ArtifactKind, LucideIcon> = {
  app: AppWindow,
  doc: FileText,
  diagram: Workflow,
  slides: Presentation,
}
const KIND_LABELS: Record<ArtifactKind, string> = { app: 'App', doc: 'Doc', diagram: 'Diagram', slides: 'Slides' }

/** English copy keys for a kind's name and for sharing each of its exports, translated with say(). */
export const kindLabel = (kind: ArtifactKind) => KIND_LABELS[kind]
export const SHARE_LABELS: Record<KindExportFormat, string> = {
  markdown: 'Share Markdown',
  html: 'Share HTML',
  svg: 'Share SVG',
  mermaid: 'Share Mermaid',
}
/** Exports the host makes and the phone hands to the share sheet once they arrive. */
export const HOST_SHARE_LABELS: Record<HostExportFormat, string> = {
  pptx: 'Share PowerPoint',
  pdf: 'Share PDF',
  png: 'Share slide images',
}

/** The small mark rows and cards show for what an artifact is, named for screen readers. */
export function ArtifactKindMark({ kind, size = 14, color }: { kind: ArtifactKind; size?: number; color: string }) {
  const say = useSay()
  const Icon = KIND_ICONS[kind]
  return (
    <Icon size={size} color={color} accessible accessibilityRole="image" accessibilityLabel={say(kindLabel(kind))} />
  )
}
