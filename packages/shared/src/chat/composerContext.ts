import type { FileContext, ViewDescriptor } from '../types'

export type EditorSelection = { content: string; selection: NonNullable<FileContext['selection']> }

type FileRef = Pick<FileContext, 'repoId' | 'path'>

/** Explicit files come first, then the active editor, then path-only references to other tabs. */
export function buildComposerContext({
  views,
  activeViewId,
  explicitFiles,
  includeTabContext,
  readBuffer,
  readSelection,
}: {
  views: ViewDescriptor[]
  activeViewId: string | null
  explicitFiles: FileRef[]
  includeTabContext: boolean
  readBuffer: (file: FileRef) => string | undefined
  readSelection: (viewId: string) => EditorSelection | undefined
}): FileContext[] {
  const context: FileContext[] = []
  const add = (file: FileContext, hydrate: () => Partial<FileContext>) => {
    if (context.length >= 30 || context.some((entry) => entry.repoId === file.repoId && entry.path === file.path))
      return
    context.push({ ...file, ...hydrate() })
  }
  for (const file of explicitFiles) add({ ...file, source: 'mention' }, () => ({ content: readBuffer(file) }))
  if (!includeTabContext) return context
  const tabs = views.filter((view) => view.kind === 'file' || view.kind === 'diff')
  const active = tabs.find((view) => view.id === activeViewId)
  for (const view of [...(active ? [active] : []), ...tabs.filter((view) => view !== active)]) {
    const file: FileContext = { repoId: view.repoId, path: view.path, source: 'tab', referenceOnly: view !== active }
    if (view.kind === 'diff') file.diff = { staged: view.staged, oid: view.oid, ...(view.stash ? { stash: true } : {}) }
    add(file, () => (view !== active ? {} : (readSelection(view.id) ?? { content: readBuffer(file) })))
  }
  return context
}
