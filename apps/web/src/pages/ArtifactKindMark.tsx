import {
  AppWindow,
  Clapperboard,
  FileText,
  Frame,
  LayoutDashboard,
  Presentation,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { ArtifactKind } from '@ramu/shared/artifacts'
import type { InteractiveDocument } from '@ramu/shared/interactive'
import {
  hostExportFormats,
  kindExports,
  type ExportedFile,
  type HostExportFormat,
  type KindExportFormat,
} from '@ramu/shared/interactiveExport'
import { notify } from '@/components/app-toaster'
import type { MenuEntry } from '../Menu'
import { notifyError } from '../chat/Notifications'
import { errorText } from '../lib/errors'
import { t } from '../i18n'

const KIND_ICONS: Record<ArtifactKind, LucideIcon> = {
  app: AppWindow,
  doc: FileText,
  diagram: Workflow,
  slides: Presentation,
  dashboard: LayoutDashboard,
  design: Frame,
  motion: Clapperboard,
}

export function artifactKindLabel(kind: ArtifactKind): string {
  return kind === 'doc'
    ? t('Doc')
    : kind === 'diagram'
      ? t('Diagram')
      : kind === 'slides'
        ? t('Slides')
        : kind === 'dashboard'
          ? t('Dashboard')
          : kind === 'design'
            ? t('Design')
            : kind === 'motion'
              ? t('Motion')
              : t('App')
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
  const content =
    file.encoding === 'base64' ? Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0)) : file.content
  const url = URL.createObjectURL(new Blob([content], { type: file.mimeType }))
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
  csv: () => t('Export CSV'),
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

const HOST_EXPORT_LABELS: Record<HostExportFormat, () => string> = {
  pptx: () => t('Export PowerPoint'),
  pdf: () => t('Export PDF'),
  png: () => t('Export slide images'),
  docx: () => t('Export Word'),
  webm: () => t('Export video'),
}

/**
 * The files the host makes for a kind (PDF for every kind, PowerPoint and slide images for a deck, Word for a doc, PNG for a diagram) for a menu. Making
 * one can take a few seconds the first time, so a toast says so until it is saved.
 */
export function hostExportEntries(
  kind: ArtifactKind,
  title: string,
  make: (format: HostExportFormat) => Promise<ExportedFile>,
  disabled = false,
): MenuEntry[] {
  return hostExportFormats(kind).map((format) => ({
    key: `export-${format}`,
    label:
      format === 'png' && kind === 'design'
        ? t('Export frame images')
        : format === 'png' && kind === 'motion'
          ? t('Export poster image')
          : format === 'png' && kind !== 'slides'
            ? t('Export PNG')
            : HOST_EXPORT_LABELS[format](),
    disabled,
    onSelect: () => {
      const toast = notify.add({ type: 'loading', title: t('Making the export…'), description: title, timeout: 0 })
      void make(format)
        .then(saveFile)
        .catch((error) => notifyError(errorText(error), title))
        .finally(() => notify.close(toast))
    },
  }))
}
