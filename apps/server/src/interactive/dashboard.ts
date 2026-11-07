// A Dashboard drawn on the host: figures and charts worked out from the tables it carries, as plain HTML with SVG
// charts in the frame's theme colors. It says when its data was read, so a copy opened later never passes for current.
import { ARTIFACT_SOURCE_FILES } from '@ramu/shared/artifacts'
import type { DashboardAggregate, DashboardSource, SlideChart } from '@ramu/shared/artifactSource'
import type { RenderedKind } from './kinds'
import { chartSvg, deckVariables } from './slides'

const MAX_CATEGORIES = 24
const CHART_BOX = { x: 0, y: 0, w: 6, h: 3.2 }

type Table = DashboardSource['datasets'][number]
type Cell = Table['rows'][number][number]

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const column = (table: Table, name: string) => table.rows.map((row) => row[table.columns.indexOf(name)] as Cell)

/** One figure's value from a column; null when there is nothing to work it out from. */
export function aggregate(values: Cell[], how: DashboardAggregate): number | null {
  if (how === 'count') return values.filter((value) => value !== null && value !== '').length
  const numbers = values.filter((value): value is number => typeof value === 'number')
  if (!numbers.length) return null
  if (how === 'sum') return numbers.reduce((a, b) => a + b, 0)
  if (how === 'average') return numbers.reduce((a, b) => a + b, 0) / numbers.length
  if (how === 'min') return Math.min(...numbers)
  if (how === 'max') return Math.max(...numbers)
  return numbers.at(-1)!
}

/**
 * A chart's categories and series: rows with the same x add up, in the order they first appear. Past 24 categories a
 * line keeps the latest and a bar or pie the largest, so the chart stays readable.
 */
export function dashboardChart(table: Table, chart: DashboardSource['charts'][number]): SlideChart {
  const xs = column(table, chart.x).map((value) => (value === null ? '—' : String(value)))
  const labels = [...new Set(xs)]
  const series = chart.y.map((name) => {
    const values = column(table, name)
    const totals = new Map<string, number>(labels.map((label) => [label, 0]))
    xs.forEach((label, index) => {
      const value = values[index]
      if (typeof value === 'number') totals.set(label, totals.get(label)! + value)
    })
    return { name, values: labels.map((label) => totals.get(label)!) }
  })
  let keep = labels.map((_, index) => index)
  if (labels.length > MAX_CATEGORIES)
    keep =
      chart.type === 'line'
        ? keep.slice(-MAX_CATEGORIES)
        : keep
            .sort((a, b) => series[0]!.values[b]! - series[0]!.values[a]!)
            .slice(0, MAX_CATEGORIES)
            .sort((a, b) => a - b)
  return {
    type: chart.type,
    labels: keep.map((index) => labels[index]!.slice(0, 40)),
    series: series.map((entry) => ({ name: entry.name, values: keep.map((index) => entry.values[index]!) })),
    ...(chart.unit ? { unit: chart.unit } : {}),
  }
}

/** Each figure's value, by its label: what a watched figure is compared on. */
export function figureValues(board: DashboardSource): Record<string, number | null> {
  const tables = new Map(board.datasets.map((table) => [table.id, table]))
  return Object.fromEntries(
    board.figures.map((figure) => [
      figure.label,
      aggregate(column(tables.get(figure.dataset)!, figure.column), figure.aggregate),
    ]),
  )
}

export const formatFigure = (value: number | null, unit = '') =>
  value === null ? '—' : `${value.toLocaleString('en', { maximumFractionDigits: 2 })}${unit}`

/** The newest time any table was read, for "As of"; null when none says. */
function asOf(board: DashboardSource): string | null {
  const times = board.datasets.flatMap((table) => (table.asOf ? [Date.parse(table.asOf)] : []))
  return times.length ? new Date(Math.max(...times)).toISOString() : null
}

const DASHBOARD_CSS =
  '.ramu-dashboard{display:flex;flex-direction:column;gap:16px;font-family:var(--font-sans);color:var(--foreground)}' +
  '.ramu-asof{margin:0;color:var(--muted);font-size:13px}' +
  '.ramu-figures{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}' +
  '.ramu-figure{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px}' +
  '.ramu-figure span{display:block;color:var(--muted);font-size:13px}' +
  '.ramu-figure strong{display:block;font-size:26px;font-weight:600;margin-top:4px;font-variant-numeric:tabular-nums}' +
  '.ramu-charts{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}' +
  '.ramu-dashchart{margin:0;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px}' +
  '.ramu-dashchart figcaption{font-weight:600;margin-bottom:8px}' +
  '.ramu-dashchart svg{display:block;width:100%;height:auto}'

export function renderDashboard(board: DashboardSource, title: string): RenderedKind {
  const tables = new Map(board.datasets.map((table) => [table.id, table]))
  const figures = board.figures.map((figure) => {
    const value = aggregate(column(tables.get(figure.dataset)!, figure.column), figure.aggregate)
    return `<div class="ramu-figure"><span>${escapeHtml(figure.label)}</span><strong>${escapeHtml(formatFigure(value, figure.unit))}</strong></div>`
  })
  const charts = board.charts.map(
    (chart) =>
      `<figure class="ramu-dashchart"><figcaption>${escapeHtml(chart.title)}</figcaption>${chartSvg(dashboardChart(tables.get(chart.dataset)!, chart), CHART_BOX)}</figure>`,
  )
  const read = asOf(board)
  const variables = deckVariables(board.theme)
  return {
    html:
      `<style>${DASHBOARD_CSS}</style><div class="ramu-dashboard" role="region" aria-label="${escapeHtml(title)}"${variables ? ` style="${variables}"` : ''}>` +
      `<p class="ramu-asof">${read ? `As of <time datetime="${read}">${escapeHtml(new Date(read).toUTCString())}</time>` : 'Data as it was when this version was published'}</p>` +
      (figures.length ? `<div class="ramu-figures">${figures.join('')}</div>` : '') +
      (charts.length ? `<div class="ramu-charts">${charts.join('')}</div>` : '') +
      '</div>',
    files: [
      {
        path: ARTIFACT_SOURCE_FILES.dashboard,
        content: JSON.stringify({
          datasets: board.datasets,
          figures: board.figures,
          charts: board.charts,
          theme: board.theme,
        }),
      },
    ],
    problems: [],
  }
}
