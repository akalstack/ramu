import PptxGenJS from 'pptxgenjs'
import type { SlidesSource } from '@ramu/shared/artifactSource'
import type { InteractiveFile } from '@ramu/shared/interactive'
import { deckColors, imageSize, placeSlide, slideText, type SlideBox } from './slides'

const FONT = 'Arial'
const MONO = 'Courier New'
const hex = (color: string) => color.replace('#', '').toUpperCase()

type TextProps = PptxGenJS.TextProps

function runsOf(markdown: string, color: string): TextProps[] {
  const blocks = slideText(markdown)
  return blocks.flatMap((block, index) =>
    block.runs.map((run, at) => ({
      text: run.text,
      options: {
        bold: run.bold,
        italic: run.italic,
        color,
        ...(run.code ? { fontFace: MONO } : {}),
        ...(block.list === 'bullet' ? { bullet: true } : block.list === 'number' ? { bullet: { type: 'number' } } : {}),
        // Each block is its own paragraph in PowerPoint, so its last run ends the line.
        ...(at === block.runs.length - 1 && index < blocks.length - 1 ? { breakLine: true } : {}),
      },
    })),
  ) as TextProps[]
}

/** The largest box with the image's own proportions that fits inside the slot, centered in it. */
function contain(box: SlideBox, width: number, height: number): SlideBox {
  const scale = Math.min(box.w / width, box.h / height)
  const w = width * scale
  const h = height * scale
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
}

/**
 * A deck as PowerPoint, written by a pinned library from the validated slide list, never by a model. Every part sits in
 * the same box as in the HTML deck, charts are native PowerPoint charts, and speaker notes are kept.
 */
export async function writePptx(deck: SlidesSource, title: string, files: InteractiveFile[]): Promise<Buffer> {
  const colors = deckColors(deck.theme)
  const color = (name: string) => hex(colors[name] ?? '#000000')
  const chartColors = [1, 2, 3, 4, 5, 6].map((n) => color(`--chart-${n}`))
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.title = title
  for (const slide of deck.slides) {
    const page = pptx.addSlide()
    page.background = { color: color('--background') }
    for (const placed of placeSlide(slide)) {
      const { x, y, w, h } = placed.box
      if (placed.part === 'rule') {
        page.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: color('--primary') }, line: { type: 'none' } })
      } else if (placed.part === 'image') {
        const file = files.find((candidate) => candidate.path === placed.path)
        const bytes = file?.encoding === 'base64' ? Buffer.from(file.content, 'base64') : null
        const size = bytes ? imageSize(bytes) : null
        if (!bytes || !size) continue
        page.addImage({
          data: `${size.mime};base64,${file!.content}`,
          altText: placed.alt,
          ...contain(placed.box, size.width, size.height),
        })
      } else if (placed.part === 'chart') {
        const chart = placed.chart
        page.addChart(
          chart.type === 'bar' ? pptx.ChartType.bar : chart.type === 'line' ? pptx.ChartType.line : pptx.ChartType.pie,
          chart.series.map((series) => ({ name: series.name, labels: chart.labels, values: series.values })),
          {
            x,
            y,
            w,
            h,
            chartColors: chart.type === 'pie' ? chart.labels.map((_, i) => chartColors[i % 6]!) : chartColors,
            showLegend: chart.type === 'pie' || chart.series.length > 1,
            legendPos: chart.type === 'pie' ? 'r' : 't',
            legendFontFace: FONT,
            legendFontSize: 12,
            legendColor: color('--foreground'),
            catAxisLabelColor: color('--muted'),
            valAxisLabelColor: color('--muted'),
            catAxisLabelFontFace: FONT,
            valAxisLabelFontFace: FONT,
            catAxisLabelFontSize: 12,
            valAxisLabelFontSize: 12,
            valGridLine: { color: color('--muted'), size: 0.5 },
            ...(chart.type === 'bar' ? { barDir: 'col', barGrouping: 'clustered' } : {}),
            ...(chart.type === 'pie' ? { showPercent: true, dataLabelColor: color('--background') } : {}),
            ...(chart.unit ? { valAxisLabelFormatCode: `General"${chart.unit.replace(/"/g, '')}"` } : {}),
          },
        )
      } else {
        const plain = ['title', 'heading', 'by'].includes(placed.part)
        const muted = ['subtitle', 'caption', 'by'].includes(placed.part)
        const ink = muted ? color('--muted') : color('--foreground')
        page.addText(plain ? placed.text : runsOf(placed.text, ink), {
          x,
          y,
          w,
          h,
          margin: 0,
          fontFace: FONT,
          fontSize: placed.size,
          color: ink,
          bold: ['title', 'heading'].includes(placed.part),
          italic: placed.part === 'quote',
          valign: placed.part === 'heading' ? 'bottom' : ['title', 'quote'].includes(placed.part) ? 'middle' : 'top',
          paraSpaceAfter: 6,
          fit: 'none',
        })
      }
    }
    if (slide.notes?.trim()) page.addNotes(slide.notes)
  }
  const written = await pptx.write({ outputType: 'nodebuffer' })
  return Buffer.isBuffer(written) ? written : Buffer.from(written as ArrayBuffer)
}
