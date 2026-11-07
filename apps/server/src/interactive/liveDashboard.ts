// Dashboards whose tables name a live source or a project file: when one is opened, the host reads those tables again from the
// dashboard's own project and draws it anew, stamped with the time it read them. A version's stored HTML stays as it
// was published; only what is shown is refreshed, at most once per interval.
import { ARTIFACT_SOURCE_FILES } from '@ramu/shared/artifacts'
import { parseArtifactSource, type DashboardSource } from '@ramu/shared/artifactSource'
import type { InteractiveDocument } from '@ramu/shared/interactive'
import { figureValues, renderDashboard } from './dashboard'

type Cell = string | number | null
type LiveTable = Pick<DashboardSource['datasets'][number], 'source' | 'file' | 'columns'>
/** Reads one live table of a project, its rows in the table's column order. */
export type ReadDashboardSource = (projectId: string, table: LiveTable) => Promise<Cell[][]>

const REFRESH_MS = 5 * 60_000

/** How long a dashboard's live read stays current: its own refresh rule, or five minutes. */
export function refreshMs(document: InteractiveDocument): number {
  const stored = document.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.dashboard)?.content
  const minutes = stored ? (JSON.parse(stored) as { refreshMinutes?: number }).refreshMinutes : undefined
  return minutes ? minutes * 60_000 : REFRESH_MS
}
const KEEP = 200

export class LiveDashboards {
  private readonly drawn = new Map<string, { at: number; document: InteractiveDocument }>()

  constructor(
    private readonly read: ReadDashboardSource,
    private readonly now: () => number = Date.now,
  ) {}

  /** The dashboard's source with its live tables read now; null when it has none, or no project to read them from. */
  private async fresh(document: InteractiveDocument, projectId: string | null): Promise<DashboardSource | null> {
    if (document.reference.kind !== 'dashboard' || !projectId) return null
    const stored = document.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.dashboard)?.content
    if (!stored) return null
    const board = JSON.parse(stored) as { datasets: LiveTable[] }
    if (!board.datasets.some((table) => table.source || table.file)) return null
    const at = new Date(this.now()).toISOString()
    const datasets = await Promise.all(
      board.datasets.map(async (table) =>
        table.source || table.file
          ? {
              ...table,
              // A source that cannot be read now shows empty rather than the published rows passing for current.
              rows: await this.read(projectId, table).catch(() => []),
              asOf: at,
            }
          : table,
      ),
    )
    const source = parseArtifactSource({ kind: 'dashboard', ...board, datasets })
    return source.kind === 'dashboard' ? source : null
  }

  /** The document as it should show now: unchanged unless it is a dashboard with live tables and a project. */
  async serve(document: InteractiveDocument, projectId: string | null): Promise<InteractiveDocument> {
    const key = `${document.reference.id}:${document.reference.version}:${projectId}`
    const kept = this.drawn.get(key)
    if (kept && this.now() - kept.at < refreshMs(document)) return kept.document
    const source = await this.fresh(document, projectId)
    if (!source) return document
    const refreshed = { ...document, html: renderDashboard(source, document.reference.title, this.now()).html }
    this.drawn.set(key, { at: this.now(), document: refreshed })
    if (this.drawn.size > KEEP) this.drawn.delete(this.drawn.keys().next().value!)
    return refreshed
  }

  /**
   * The watched figures' values read now, by label, with their units; null when the dashboard watches none. The host
   * compares them with the last read to tell the person's devices what changed.
   */
  async watched(
    document: InteractiveDocument,
    projectId: string | null,
  ): Promise<Record<string, { value: number | null; unit: string }> | null> {
    const stored = document.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.dashboard)?.content
    if (
      !stored ||
      !(JSON.parse(stored) as { figures?: { notify?: boolean }[] }).figures?.some((figure) => figure.notify)
    )
      return null
    const source = await this.fresh(document, projectId)
    if (!source) return null
    const values = figureValues(source)
    return Object.fromEntries(
      source.figures
        .filter((figure) => figure.notify)
        .map((figure) => [figure.label, { value: values[figure.label] ?? null, unit: figure.unit ?? '' }]),
    )
  }
}

type Watched = Record<string, { value: number | null; unit: string }>
type WatchedRead = { at: number; values: Watched }
const shown = ({ value, unit }: { value: number | null; unit: string }) =>
  value === null ? '—' : `${value.toLocaleString('en', { maximumFractionDigits: 2 })}${unit}`

/**
 * One round of watching: every kept dashboard with watched figures is read again from its project, and each figure
 * that changed since the last round is told to the person's devices. The first round only remembers the values.
 */
export async function watchDashboards(deps: {
  dashboards: () => { id: string; title: string; projectId: string | null }[]
  document: (artifactId: string) => InteractiveDocument
  live: LiveDashboards
  memory: { read(): Record<string, WatchedRead>; write(values: Record<string, WatchedRead>): void }
  notify: (artifactId: string, body: string) => void
  now?: () => number
}) {
  const now = (deps.now ?? Date.now)()
  const before = deps.memory.read()
  const after: Record<string, WatchedRead> = {}
  for (const page of deps.dashboards()) {
    const document = deps.document(page.id)
    const last = before[page.id]
    // A dashboard read again more slowly than the watch runs keeps its last values until its own interval passes.
    if (last && now - last.at < refreshMs(document)) {
      after[page.id] = last
      continue
    }
    const read = await deps.live.watched(document, page.projectId).catch(() => null)
    if (!read) continue
    after[page.id] = { at: now, values: read }
    const was = last?.values
    if (!was) continue
    const changes = Object.entries(read)
      .filter(([label, current]) => was[label] && was[label].value !== current.value)
      .map(([label, current]) => `${label}: ${shown(was[label]!)} → ${shown(current)}`)
    if (changes.length) deps.notify(page.id, changes.join(' · ').slice(0, 240))
  }
  deps.memory.write(after)
}
