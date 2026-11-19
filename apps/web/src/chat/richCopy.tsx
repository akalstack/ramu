import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * A reply as plain HTML for the clipboard: headings, lists, tables, code and links as their own elements, with none of
 * the app's classes, so a document, mail or note it is pasted into keeps the structure in its own style.
 */
export function markdownHtml(markdown: string): string {
  return renderToStaticMarkup(<Markdown remarkPlugins={[remarkGfm]}>{markdown}</Markdown>)
}

/** Cell text on one line, so a cell never splits into rows in a spreadsheet. */
const cellText = (cell: Element) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim()

/**
 * A rendered table for the clipboard: tab-separated rows, which spreadsheets paste into cells, and the table itself as
 * plain HTML for documents. Classes and styles are left behind; alignment stays as the `align` a document understands.
 */
export function tableClipboard(table: HTMLTableElement): { text: string; html: string } {
  const text = [...table.rows].map((row) => [...row.cells].map(cellText).join('\t')).join('\n')
  const copy = table.cloneNode(true) as HTMLTableElement
  for (const element of [copy, ...copy.querySelectorAll('*')]) {
    const align = (element as HTMLElement).style?.textAlign
    for (const name of [...element.getAttributeNames()])
      if (name !== 'href' && name !== 'colspan' && name !== 'rowspan') element.removeAttribute(name)
    if (align && (element.tagName === 'TD' || element.tagName === 'TH')) element.setAttribute('align', align)
  }
  return { text, html: copy.outerHTML }
}
