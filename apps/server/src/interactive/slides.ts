import { ARTIFACT_SOURCE_FILES } from '@ramu/shared/artifacts'
import type { Slide, SlideChart, SlidesSource, SlideTheme } from '@ramu/shared/artifactSource'
import type { InteractiveFile } from '@ramu/shared/interactive'
import { interactivePaletteFromVariant, interactiveThemeVariables } from '@ramu/shared/interactiveTheme'
import { DEFAULT_DARK, DEFAULT_LIGHT } from '@ramu/shared/theme'
import type { RenderedKind } from './kinds'

/**
 * The page every slide is laid out on, in inches: PowerPoint's 16:9 widescreen. The HTML deck and the PPTX place every
 * part in the same boxes, so the preview's fit check speaks for the exported file too.
 */
export const SLIDE_WIDTH = 13.333
export const SLIDE_HEIGHT = 7.5
const MARGIN = 0.7
const INNER = SLIDE_WIDTH - 2 * MARGIN
const BOTTOM = SLIDE_HEIGHT - 0.6

export interface SlideBox {
  x: number
  y: number
  w: number
  h: number
}

/** A part of a slide and the box it fills. Text parts carry their size in points. */
export type PlacedPart =
  | {
      part: 'title' | 'heading' | 'subtitle' | 'body' | 'left' | 'right' | 'caption' | 'quote' | 'by'
      box: SlideBox
      size: number
      text: string
    }
  | { part: 'image'; box: SlideBox; path: string; alt: string }
  | { part: 'chart'; box: SlideBox; chart: SlideChart }
  | { part: 'rule'; box: SlideBox }

const TOP: SlideBox = { x: MARGIN, y: 0.5, w: INNER, h: 1.0 }
const text = (part: Extract<PlacedPart, { text: string }>['part'], box: SlideBox, size: number, value: string) => ({
  part,
  box,
  size,
  text: value,
})

/** Where each part of a slide goes, by layout. Parts a slide leaves out free their room for the rest. */
export function placeSlide(slide: Slide): PlacedPart[] {
  const parts: PlacedPart[] = []
  const title = slide.title?.trim()
  const body = slide.body?.trim()
  const start = title ? 1.7 : 0.6
  if (slide.layout === 'title') {
    parts.push(text('heading', { x: MARGIN, y: 2.0, w: INNER, h: 2.0 }, 44, title ?? ''))
    if (body) parts.push(text('subtitle', { x: MARGIN, y: 4.2, w: INNER, h: 1.8 }, 24, body))
    return parts
  }
  if (slide.layout === 'quote') {
    parts.push({ part: 'rule', box: { x: MARGIN, y: 1.4, w: 0.08, h: 4.0 } })
    parts.push(text('quote', { x: MARGIN + 0.5, y: 1.4, w: INNER - 0.5, h: 4.0 }, 30, body ?? ''))
    if (slide.by?.trim()) parts.push(text('by', { x: MARGIN + 0.5, y: 5.6, w: INNER - 0.5, h: 0.7 }, 16, slide.by))
    return parts
  }
  if (title) parts.push(text('title', TOP, 32, title))
  const height = BOTTOM - start
  if (slide.layout === 'content') {
    const half = (INNER - 0.4) / 2
    parts.push(text('body', { x: MARGIN, y: start, w: slide.image ? half : INNER, h: height }, 20, body ?? ''))
    if (slide.image)
      parts.push({ part: 'image', box: { x: MARGIN + half + 0.4, y: start, w: half, h: height }, ...slide.image })
  } else if (slide.layout === 'two-columns') {
    const half = (INNER - 0.5) / 2
    const [left, right] = slide.columns ?? ['', '']
    parts.push(text('left', { x: MARGIN, y: start, w: half, h: height }, 20, left))
    parts.push(text('right', { x: MARGIN + half + 0.5, y: start, w: half, h: height }, 20, right))
  } else {
    // An image or chart fills the slide under its title, above a one-line caption when there is one.
    const caption = body ? 0.8 : 0
    const box = { x: MARGIN, y: start, w: INNER, h: height - (caption ? caption + 0.2 : 0) }
    if (slide.layout === 'image' && slide.image) parts.push({ part: 'image', box, ...slide.image })
    if (slide.layout === 'chart' && slide.chart) parts.push({ part: 'chart', box, chart: slide.chart })
    if (body) parts.push(text('caption', { x: MARGIN, y: BOTTOM - caption, w: INNER, h: caption }, 14, body))
  }
  return parts
}

export interface TextRun {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
}
/** One paragraph or list item of slide text. */
export interface TextBlock {
  list: 'none' | 'bullet' | 'number'
  runs: TextRun[]
}

const INLINE = /\*\*(.+?)\*\*|__(.+?)__|\*(\S(?:.*?\S)?)\*|_(\S(?:.*?\S)?)_|`([^`]+)`|\[([^\]]+)\]\([^)]*\)/g

function runsOf(line: string): TextRun[] {
  const runs: TextRun[] = []
  let at = 0
  for (const match of line.matchAll(INLINE)) {
    if (match.index > at) runs.push({ text: line.slice(at, match.index) })
    const [, bold, bold2, italic, italic2, code, link] = match
    if (bold ?? bold2) runs.push({ text: (bold ?? bold2)!, bold: true })
    else if (italic ?? italic2) runs.push({ text: (italic ?? italic2)!, italic: true })
    else if (code) runs.push({ text: code, code: true })
    // A slide has nowhere to go, so a link keeps only its words.
    else runs.push({ text: link! })
    at = match.index + match[0].length
  }
  if (at < line.length) runs.push({ text: line.slice(at) })
  return runs
}

/**
 * Slide text: paragraphs, "- " bullets and "1. " numbered items, with bold, italic and code inside a line. Anything
 * else in Markdown stays as the words it is written with.
 */
export function slideText(markdown: string): TextBlock[] {
  const blocks: TextBlock[] = []
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) blocks.push({ list: 'none', runs: runsOf(paragraph.join(' ')) })
    paragraph = []
  }
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()
    const bullet = /^[-*•]\s+(.*)$/.exec(line)
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line)
    if (!line) flush()
    else if (bullet || numbered) {
      flush()
      blocks.push({ list: bullet ? 'bullet' : 'number', runs: runsOf((bullet ?? numbered)![1]!) })
    } else paragraph.push(line)
  }
  flush()
  return blocks
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function textHtml(markdown: string): string {
  const run = (value: TextRun) => {
    const inner = escapeHtml(value.text)
    return value.bold
      ? `<strong>${inner}</strong>`
      : value.italic
        ? `<em>${inner}</em>`
        : value.code
          ? `<code>${inner}</code>`
          : inner
  }
  let html = ''
  let open: 'ul' | 'ol' | null = null
  for (const block of slideText(markdown)) {
    const list = block.list === 'bullet' ? 'ul' : block.list === 'number' ? 'ol' : null
    if (open && open !== list) html += `</${open}>`
    if (list && open !== list) html += `<${list}>`
    open = list
    const runs = block.runs.map(run).join('')
    html += list ? `<li>${runs}</li>` : `<p>${runs}</p>`
  }
  return open ? `${html}</${open}>` : html
}

/** The width and height of a PNG or JPEG, read from its header; null for anything else. */
export function imageSize(bytes: Buffer): { width: number; height: number; mime: 'image/png' | 'image/jpeg' } | null {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.toString('latin1', 12, 16) === 'IHDR')
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), mime: 'image/png' }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let at = 2
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1]!
    const length = bytes.readUInt16BE(at + 2)
    // Start-of-frame markers carry the size; DHT (C4), JPG (C8) and DAC (CC) share the range but do not.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7), mime: 'image/jpeg' }
    at += 2 + length
  }
  return null
}

/** The concrete colors a deck uses where the reader's theme cannot reach it: exported files. */
export function deckColors(theme: SlideTheme): Record<string, string> {
  const scheme = theme.appearance === 'dark' ? 'dark' : 'light'
  const variables = interactiveThemeVariables(
    interactivePaletteFromVariant(scheme === 'dark' ? DEFAULT_DARK : DEFAULT_LIGHT, scheme),
  )
  return theme.accent ? { ...variables, '--primary': theme.accent, '--chart-1': theme.accent } : variables
}

/** Variables the deck sets on itself: a fixed light or dark palette, and the accent over the reader's own. */
function deckVariables(theme: SlideTheme): string {
  const variables =
    theme.appearance === 'auto'
      ? theme.accent
        ? { '--primary': theme.accent, '--chart-1': theme.accent }
        : {}
      : deckColors(theme)
  return Object.entries(variables)
    .filter(([name]) => name !== '--scheme')
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
}

const format = (value: number, unit = '') => `${value.toLocaleString('en', { maximumFractionDigits: 2 })}${unit}`

/** A bar, line or pie chart as SVG in the theme's chart colors, sized for its box with text at slide point sizes. */
function chartSvg(chart: SlideChart, box: SlideBox): string {
  const width = 1000
  const height = Math.round((width * box.h) / box.w)
  // SVG units per point of type, so labels match the deck's text at any width.
  const pt = width / (box.w * 72)
  const label = 12 * pt
  const color = (index: number) => `var(--chart-${(index % 6) + 1})`
  const summary = chart.labels
    .map(
      (name, index) => `${name}: ${chart.series.map((series) => format(series.values[index]!, chart.unit)).join(', ')}`,
    )
    .join('; ')
  const parts: string[] = []
  const legend = chart.type === 'pie' ? chart.labels : chart.series.length > 1 ? chart.series.map((s) => s.name) : []
  const legendHeight = legend.length && chart.type !== 'pie' ? label * 2 : 0
  legend.forEach((name, index) => {
    const x = chart.type === 'pie' ? width * 0.62 : 0
    const y = chart.type === 'pie' ? height / 2 - (legend.length * label * 1.6) / 2 + index * label * 1.6 : 0
    const dx = chart.type === 'pie' ? 0 : index * (width / Math.min(legend.length, 6))
    const share =
      chart.type === 'pie'
        ? ` ${format(chart.series[0]!.values[index]!, chart.unit)} (${Math.round((chart.series[0]!.values[index]! / chart.series[0]!.values.reduce((a, b) => a + b, 0)) * 100)}%)`
        : ''
    parts.push(
      `<rect x="${x + dx}" y="${y + label * 0.2}" width="${label * 0.8}" height="${label * 0.8}" rx="${label * 0.15}" fill="${color(index)}"/>` +
        `<text x="${x + dx + label * 1.2}" y="${y + label}" font-size="${label}" fill="var(--foreground)">${escapeHtml(name + share)}</text>`,
    )
  })
  if (chart.type === 'pie') {
    const values = chart.series[0]!.values
    const total = values.reduce((sum, value) => sum + value, 0)
    const radius = Math.min(width * 0.28, height / 2 - label)
    const cx = width * 0.3
    const cy = height / 2
    let angle = -Math.PI / 2
    values.forEach((value, index) => {
      if (value <= 0) return
      const sweep = (value / total) * Math.PI * 2
      if (sweep >= Math.PI * 2 - 1e-9) {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color(index)}"/>`)
        return
      }
      const point = (a: number) => `${(cx + radius * Math.cos(a)).toFixed(2)} ${(cy + radius * Math.sin(a)).toFixed(2)}`
      parts.push(
        `<path d="M${cx} ${cy}L${point(angle)}A${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${point(angle + sweep)}Z" fill="${color(index)}" stroke="var(--background)" stroke-width="${pt}"/>`,
      )
      angle += sweep
    })
  } else {
    const values = chart.series.flatMap((series) => series.values)
    // Gridlines fall on round numbers: a step of 1, 2, 2.5 or 5 times a power of ten.
    const low = Math.min(0, ...values)
    const high = Math.max(0, ...values)
    const raw = (high - low || 1) / 4
    const magnitude = 10 ** Math.floor(Math.log10(raw))
    const tick = [1, 2, 2.5, 5, 10].map((n) => n * magnitude).find((n) => n >= raw)!
    const min = Math.floor(low / tick) * tick
    const max = Math.max(min + tick, Math.ceil(high / tick) * tick)
    const left = label * 5
    const top = legendHeight + label
    const bottom = height - label * 2
    const plotWidth = width - left
    const y = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top)
    for (let value = min; value <= max + tick / 2; value += tick) {
      parts.push(
        `<line x1="${left}" x2="${width}" y1="${y(value)}" y2="${y(value)}" stroke="var(--border)" stroke-width="${pt}"/>` +
          `<text x="${left - label * 0.5}" y="${y(value) + label * 0.35}" font-size="${label}" text-anchor="end" fill="var(--muted)">${escapeHtml(format(value, chart.unit))}</text>`,
      )
    }
    const group = plotWidth / chart.labels.length
    chart.labels.forEach((name, index) => {
      parts.push(
        `<text x="${left + group * (index + 0.5)}" y="${height - label * 0.5}" font-size="${label}" text-anchor="middle" fill="var(--muted)">${escapeHtml(name)}</text>`,
      )
    })
    if (chart.type === 'bar') {
      const bar = (group * 0.8) / chart.series.length
      chart.series.forEach((series, s) =>
        series.values.forEach((value, index) => {
          const x = left + group * index + group * 0.1 + bar * s
          parts.push(
            `<rect x="${x}" y="${Math.min(y(value), y(0))}" width="${bar * 0.92}" height="${Math.abs(y(value) - y(0))}" fill="${color(s)}"/>`,
          )
        }),
      )
    } else
      chart.series.forEach((series, s) => {
        const points = series.values.map((value, index) => `${left + group * (index + 0.5)},${y(value)}`)
        parts.push(
          `<polyline points="${points.join(' ')}" fill="none" stroke="${color(s)}" stroke-width="${pt * 2.5}" stroke-linejoin="round"/>`,
          ...points.map((point) => {
            const [cx, cy] = point.split(',')
            return `<circle cx="${cx}" cy="${cy}" r="${pt * 4}" fill="${color(s)}"/>`
          }),
        )
      })
  }
  const name = `${chart.type[0]!.toUpperCase()}${chart.type.slice(1)} chart`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(`${name}. ${summary}`)}" font-family="var(--font-sans)">${parts.join('')}</svg>`
}

// Every size is a share of the slide's width (cqw), so a slide looks the same at any size and the preview's fit check
// holds for the printed and exported deck. Title boxes align with `safe`, so text that is too long overflows downward
// where the check sees it.
const SLIDES_CSS =
  '.ramu-deck{display:flex;flex-direction:column;gap:16px;max-width:1280px;margin:0 auto;font-family:var(--font-sans)}' +
  '.ramu-slide{position:relative;container-type:inline-size;aspect-ratio:16/9;overflow:hidden;background:var(--background);color:var(--foreground);border:1px solid var(--border);border-radius:8px}' +
  '.ramu-part{position:absolute;overflow:hidden;margin:0;line-height:1.2;overflow-wrap:break-word}' +
  '.ramu-part :where(p,ul,ol){margin:0 0 .45em}.ramu-part>:last-child{margin-bottom:0}.ramu-part :where(ul,ol){padding-left:1.15em}.ramu-part li+li{margin-top:.25em}' +
  '.ramu-part li::marker{color:var(--primary)}.ramu-part code{font-family:var(--font-mono);font-size:.9em}' +
  '.ramu-title,.ramu-heading,.ramu-quote{display:flex;flex-direction:column;font-weight:700}.ramu-title{justify-content:safe center}.ramu-heading{justify-content:safe flex-end}' +
  '.ramu-quote{justify-content:safe center;font-style:italic;font-weight:400}.ramu-subtitle,.ramu-caption,.ramu-by{color:var(--muted)}' +
  '.ramu-rule{background:var(--primary);border-radius:2px}' +
  '.ramu-image img,.ramu-chart svg{display:block;width:100%;height:100%;object-fit:contain;max-width:none}' +
  '[data-ramu-present],[data-ramu-present] body{height:100%;margin:0;padding:0;overflow:hidden;background:#000}' +
  '[data-ramu-present] .ramu-slide{display:none}' +
  '[data-ramu-present] .ramu-slide[data-ramu-current]{display:block;position:fixed;inset:0;margin:auto;width:min(100vw,177.78vh);height:min(56.25vw,100vh);border:0;border-radius:0}' +
  '@media print{@page{size:13.333in 7.5in;margin:0}html{background:none}body{margin:0;padding:0}.ramu-deck{display:block;max-width:none}' +
  '.ramu-slide{width:13.333in;border:0;border-radius:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}.ramu-slide+.ramu-slide{break-before:page}}'

const PART_CLASS: Record<string, string> = {
  title: 'ramu-title',
  heading: 'ramu-heading',
  subtitle: 'ramu-subtitle',
  caption: 'ramu-caption',
  quote: 'ramu-quote',
  by: 'ramu-by',
}

const percent = (value: number, of: number) => `${((value / of) * 100).toFixed(3)}%`
const boxStyle = (box: SlideBox) =>
  `left:${percent(box.x, SLIDE_WIDTH)};top:${percent(box.y, SLIDE_HEIGHT)};width:${percent(box.w, SLIDE_WIDTH)};height:${percent(box.h, SLIDE_HEIGHT)}`
// A point of type as a share of the slide's width.
const cqw = (points: number) => `${((points / 72 / SLIDE_WIDTH) * 100).toFixed(3)}cqw`

const PART_NAME: Record<string, string> = {
  title: 'title',
  heading: 'title',
  subtitle: 'subtitle',
  body: 'body',
  left: 'left column',
  right: 'right column',
  caption: 'caption',
  quote: 'quote',
  by: 'attribution',
}

/**
 * A deck as plain HTML for the sandboxed frame: one 16:9 section per slide, stacked, with charts as SVG and images as
 * data the version keeps. Every text box is marked for the preview's fit check.
 */
export function renderSlides(deck: SlidesSource, title: string, files: InteractiveFile[]): RenderedKind {
  const problems: string[] = []
  const images = new Map<string, InteractiveFile & { mime: string }>()
  for (const file of files) {
    const size = file.encoding === 'base64' ? imageSize(Buffer.from(file.content, 'base64')) : null
    if (size) images.set(file.path, { ...file, mime: size.mime })
  }
  const used = new Set<string>()
  const slides = deck.slides.map((slide, index) => {
    const number = index + 1
    const parts = placeSlide(slide).map((placed) => {
      const style = boxStyle(placed.box)
      if (placed.part === 'rule') return `<div class="ramu-part ramu-rule" style="${style}"></div>`
      if (placed.part === 'chart')
        return `<div class="ramu-part ramu-chart" style="${style}">${chartSvg(placed.chart, placed.box)}</div>`
      if (placed.part === 'image') {
        const image = images.get(placed.path)
        if (!image) {
          problems.push(
            `Slide ${number} shows ${placed.path}, which is not among the images in files. Send it as a PNG or JPEG with encoding base64.`,
          )
          return ''
        }
        used.add(placed.path)
        return `<div class="ramu-part ramu-image" style="${style}"><img alt="${escapeHtml(placed.alt)}" src="data:${image.mime};base64,${image.content}"></div>`
      }
      const content = ['title', 'heading', 'by'].includes(placed.part) ? escapeHtml(placed.text) : textHtml(placed.text)
      return `<div class="ramu-part ${PART_CLASS[placed.part] ?? ''}" data-ramu-fit="Slide ${number} ${PART_NAME[placed.part]}" style="${style};font-size:${cqw(placed.size)}">${content}</div>`
    })
    return `<section class="ramu-slide" data-ramu-slide aria-label="Slide ${number} of ${deck.slides.length}">${parts.join('')}</section>`
  })
  for (const file of files)
    if (!images.has(file.path))
      problems.push(`${file.path} is not a PNG or JPEG sent with encoding base64. A deck's files are its images.`)
  const variables = deckVariables(deck.theme)
  return {
    html: `<style>${SLIDES_CSS}</style><div class="ramu-deck" role="region" aria-label="${escapeHtml(title)}"${variables ? ` style="${variables}"` : ''}>${slides.join('')}</div>`,
    files: [
      { path: ARTIFACT_SOURCE_FILES.slides, content: JSON.stringify({ slides: deck.slides, theme: deck.theme }) },
      ...files
        .filter((file) => used.has(file.path))
        .map(({ path, content }) => ({ path, content, encoding: 'base64' as const })),
    ],
    problems: [...new Set(problems)].slice(0, 20),
  }
}
