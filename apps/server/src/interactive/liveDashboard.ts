// Dashboards whose tables name a live source: when one is opened, the host reads those tables again from the
// dashboard's own project and draws it anew, stamped with the time it read them. A version's stored HTML stays as it
// was published; only what is shown is refreshed, at most once per interval.
import { ARTIFACT_SOURCE_FILES } from '@ramu/shared/artifacts'
import { parseArtifactSource, type DashboardSourceKind } from '@ramu/shared/artifactSource'
import type { InteractiveDocument } from '@ramu/shared/interactive'
import { renderDashboard } from './dashboard'

type Cell = string | number | null
/** Reads one live table of a project, its rows in the source's fixed column order. */
export type ReadDashboardSource = (projectId: string, source: DashboardSourceKind) => Promise<Cell[][]>

const REFRESH_MS = 5 * 60_000
const KEEP = 200

export class LiveDashboards {
  private readonly drawn = new Map<string, { at: number; document: InteractiveDocument }>()

  constructor(
    private readonly read: ReadDashboardSource,
    private readonly now: () => number = Date.now,
  ) {}

  /** The document as it should show now: unchanged unless it is a dashboard with live tables and a project. */
  async serve(document: InteractiveDocument, projectId: string | null): Promise<InteractiveDocument> {
    if (document.reference.kind !== 'dashboard' || !projectId) return document
    const stored = document.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.dashboard)?.content
    if (!stored) return document
    const board = JSON.parse(stored) as { datasets: { source?: DashboardSourceKind }[] }
    if (!board.datasets.some((table) => table.source)) return document
    const key = `${document.reference.id}:${document.reference.version}:${projectId}`
    const kept = this.drawn.get(key)
    if (kept && this.now() - kept.at < REFRESH_MS) return kept.document
    const at = new Date(this.now()).toISOString()
    const datasets = await Promise.all(
      board.datasets.map(async (table) =>
        table.source
          ? {
              ...table,
              // A source that cannot be read now shows empty rather than the published rows passing for current.
              rows: await this.read(projectId, table.source).catch(() => []),
              asOf: at,
            }
          : table,
      ),
    )
    const source = parseArtifactSource({ kind: 'dashboard', ...board, datasets })
    if (source.kind !== 'dashboard') return document
    const refreshed = { ...document, html: renderDashboard(source, document.reference.title).html }
    this.drawn.set(key, { at: this.now(), document: refreshed })
    if (this.drawn.size > KEEP) this.drawn.delete(this.drawn.keys().next().value!)
    return refreshed
  }
}
