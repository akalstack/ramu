import { AppWindow, FileText, Workflow, type LucideIcon } from 'lucide-react'
import type { ArtifactKind } from '@ramu/shared/artifacts'
import type { InteractiveDocument } from '@ramu/shared/interactive'
import { kindExports, type ExportedFile, type KindExportFormat } from '@ramu/shared/interactiveExport'
import type { MenuEntry } from '../Menu'
import { t } from '../i18n'

const KIND_ICONS: Record<ArtifactKind, LucideIcon> = { app: AppWindow, doc: FileText, diagram: Workflow }

export function artifactKindLabel(kind: ArtifactKind): string {
  return kind === 'doc' ? t('Doc') : kind === 'diagram' ? t('Diagram') : t('App')
}

/**
 * The small mark rows and cards show for what an artifact is. It is named for screen readers unless the kind's name is
 * written beside it.
 */
export function ArtifactKindMark({
  kind,
  size = 14,
  className,
  named = true,
}: {
  kind: ArtifactKind
  size?: number
  className?: string
  named?: boolean
}) {
  const Icon = KIND_ICONS[kind]
  return named ? (
    <Icon size={size} className={className} role="img" aria-label={artifactKindLabel(kind)} />
  ) : (
    <Icon size={size} className={className} aria-hidden />
  )
}

/** Saves a file through the browser's download, as every export on the desktop does. */
export function saveFile(file: ExportedFile) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const EXPORT_LABELS: Record<KindExportFormat, () => string> = {
  markdown: () => t('Export Markdown'),
  html: () => t('Export HTML'),
  svg: () => t('Export SVG'),
  mermaid: () => t('Export Mermaid'),
}

/**
 * A Doc's or Diagram's own exports for a menu, in the palette the reader is looking at; empty for an App, which keeps
 * its HTML and source exports.
 */
export function kindExportEntries(document: InteractiveDocument | null, theme: Record<string, string>): MenuEntry[] {
  if (!document) return []
  return kindExports(document, theme).map(({ format, file }) => ({
    key: `export-${format}`,
    label: EXPORT_LABELS[format](),
    onSelect: () => saveFile(file),
  }))
}
