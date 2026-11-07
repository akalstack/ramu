// A Doc's Word file, written from its Markdown source with a pinned writer library, never by a model. Nothing is
// fetched: images keep their description, and links stay links only for web and mail addresses.
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

/** The parts of a Markdown syntax tree this writer reads. */
interface MdNode {
  type: string
  value?: string
  depth?: number
  ordered?: boolean | null
  checked?: boolean | null
  url?: string
  alt?: string | null
  identifier?: string
  label?: string | null
  children?: MdNode[]
}

interface RunStyle {
  bold?: boolean
  italics?: boolean
  strike?: boolean
  code?: boolean
}

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const
const MONO = 'Courier New'
const LINKABLE = /^(https?:|mailto:)/i

function runs(nodes: MdNode[] | undefined, style: RunStyle = {}): ParagraphChild[] {
  const out: ParagraphChild[] = []
  for (const node of nodes ?? []) {
    switch (node.type) {
      case 'text':
      case 'html':
        out.push(text(node.value ?? '', style))
        break
      case 'inlineCode':
        out.push(text(node.value ?? '', { ...style, code: true }))
        break
      case 'strong':
        out.push(...runs(node.children, { ...style, bold: true }))
        break
      case 'emphasis':
        out.push(...runs(node.children, { ...style, italics: true }))
        break
      case 'delete':
        out.push(...runs(node.children, { ...style, strike: true }))
        break
      case 'break':
        out.push(new TextRun({ text: '', break: 1 }))
        break
      case 'link':
        if (node.url && LINKABLE.test(node.url))
          out.push(
            new ExternalHyperlink({
              link: node.url,
              children: plain(node.children).map((part) => new TextRun({ text: part, style: 'Hyperlink' })),
            }),
          )
        else out.push(...runs(node.children, style))
        break
      case 'image':
        if (node.alt) out.push(text(`[${node.alt}]`, { ...style, italics: true }))
        break
      case 'footnoteReference':
        out.push(new TextRun({ text: `[${node.label ?? node.identifier ?? ''}]`, superScript: true }))
        break
      default:
        out.push(...runs(node.children, style))
    }
  }
  return out
}

function text(value: string, style: RunStyle): TextRun {
  return new TextRun({
    text: value,
    ...(style.bold ? { bold: true } : {}),
    ...(style.italics ? { italics: true } : {}),
    ...(style.strike ? { strike: true } : {}),
    ...(style.code ? { font: MONO } : {}),
  })
}

function plain(nodes: MdNode[] | undefined): string[] {
  return (nodes ?? []).flatMap((node) => (node.value !== undefined ? [node.value] : plain(node.children)))
}

function blocks(nodes: MdNode[] | undefined, depth = 0): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  for (const node of nodes ?? []) {
    switch (node.type) {
      case 'heading':
        out.push(new Paragraph({ heading: HEADINGS[Math.min(6, node.depth ?? 1) - 1], children: runs(node.children) }))
        break
      case 'paragraph':
        out.push(new Paragraph({ children: runs(node.children) }))
        break
      case 'blockquote':
        out.push(
          new Paragraph({
            indent: { left: 567 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'BBBBBB', space: 8 } },
            children: runs(quoteText(node.children), { italics: true }),
          }),
        )
        break
      case 'code':
        for (const line of (node.value ?? '').split('\n'))
          out.push(
            new Paragraph({
              shading: { type: ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' },
              spacing: { after: 0 },
              children: [new TextRun({ text: line, font: MONO, size: 19 })],
            }),
          )
        out.push(new Paragraph({ children: [] }))
        break
      case 'list':
        out.push(...list(node, depth))
        break
      case 'table':
        out.push(table(node))
        break
      case 'thematicBreak':
        out.push(
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 1 } },
            children: [],
          }),
        )
        break
      case 'html':
        out.push(new Paragraph({ children: [text(node.value ?? '', {})] }))
        break
      case 'footnoteDefinition':
        out.push(
          new Paragraph({
            children: [
              new TextRun({ text: `[${node.label ?? node.identifier ?? ''}] `, superScript: true }),
              ...node.children!.flatMap((child) => runs(child.children)),
            ],
          }),
        )
        break
      default:
        if (node.children) out.push(...blocks(node.children, depth))
    }
  }
  return out
}

/** A quote's paragraphs as one run of text, separated by line breaks, so the left rule stays continuous. */
function quoteText(nodes: MdNode[] | undefined): MdNode[] {
  return (nodes ?? []).flatMap((node, index) => [
    ...(index ? [{ type: 'break' }] : []),
    ...(node.type === 'paragraph' ? (node.children ?? []) : [{ type: 'text', value: plain([node]).join('') }]),
  ])
}

function list(node: MdNode, depth: number): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  const level = Math.min(depth, 8)
  for (const item of node.children ?? []) {
    const [first, ...rest] = item.children ?? []
    const box = item.checked === true ? '☑ ' : item.checked === false ? '☐ ' : ''
    out.push(
      new Paragraph({
        numbering: { reference: node.ordered ? 'ordered' : 'bullets', level },
        children: [...(box ? [text(box, {})] : []), ...(first?.type === 'paragraph' ? runs(first.children) : [])],
      }),
    )
    const nested = first && first.type !== 'paragraph' ? [first, ...rest] : rest
    for (const child of nested)
      out.push(...(child.type === 'list' ? list(child, depth + 1) : blocks([child], depth + 1)))
  }
  return out
}

function table(node: MdNode): Table {
  const rows = node.children ?? []
  const columns = Math.max(1, ...rows.map((row) => row.children?.length ?? 0))
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (row, index) =>
        new TableRow({
          tableHeader: index === 0,
          children: Array.from(
            { length: columns },
            (_, column) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: runs(row.children?.[column]?.children, index === 0 ? { bold: true } : {}),
                  }),
                ],
              }),
          ),
        }),
    ),
  })
}

const levels = (format: (typeof LevelFormat)[keyof typeof LevelFormat], marks: string[]) =>
  marks.map((mark, level) => ({
    level,
    format,
    text: mark,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } },
  }))

export async function writeDocx(markdown: string, title: string): Promise<Buffer> {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as unknown as MdNode
  const document = new Document({
    title,
    creator: 'Ramu',
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: levels(LevelFormat.BULLET, ['•', '◦', '▪', '•', '◦', '▪', '•', '◦', '▪']),
        },
        {
          reference: 'ordered',
          levels: levels(
            LevelFormat.DECIMAL,
            Array.from({ length: 9 }, (_, level) => `%${level + 1}.`),
          ),
        },
      ],
    },
    sections: [{ children: blocks(tree.children) }],
  })
  return Packer.toBuffer(document)
}
