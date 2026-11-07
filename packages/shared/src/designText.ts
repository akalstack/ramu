// The words in a design's frames, which a person can change in place while the markup and styles stay as the agent
// made them. A run is the text between two tags, outside <style> and <script>, that is more than whitespace.
import { z } from 'zod'
import { DESIGN_FRAMES_MAX } from './artifactSource'

const PIECES = /(<!--[\s\S]*?-->)|(<\/?([a-zA-Z][\w-]*)[^>]*>)|([^<]+)|(<)/g
const RAW = new Set(['style', 'script'])
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const decode = (text: string) =>
  text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
    }
    return NAMED[name.toLowerCase()] ?? entity
  })
const encode = (text: string) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

/** Calls `visit` with each text run of a frame's markup, decoded, and returns the markup with what it returned. */
function mapRuns(html: string, visit: (text: string, index: number) => string): string {
  let raw: string | null = null
  let index = 0
  return html.replace(PIECES, (piece, comment, tag, name: string | undefined, text: string | undefined) => {
    if (tag) {
      const lower = name!.toLowerCase()
      if (raw && piece.startsWith('</') && lower === raw) raw = null
      else if (!raw && RAW.has(lower) && !piece.startsWith('</') && !piece.endsWith('/>')) raw = lower
      return piece
    }
    if (comment || raw || text === undefined || !decode(text).trim()) return piece
    const lead = text.match(/^\s*/)![0]
    const trail = text.slice(lead.length).match(/\s*$/)![0]
    const words = decode(text.slice(lead.length, text.length - trail.length))
    const next = visit(words, index++)
    return next === words ? piece : `${lead}${encode(next)}${trail}`
  })
}

/** A frame's text runs, in reading order of its markup. */
export function designTexts(html: string): string[] {
  const texts: string[] = []
  mapRuns(html, (text) => (texts.push(text), text))
  return texts
}

/** The frame's markup with each text run replaced by the person's words; refused if the runs no longer line up. */
export function withDesignTexts(html: string, texts: string[]): string {
  const count = designTexts(html).length
  if (texts.length !== count) throw new Error('The design changed while you were editing. Reopen it and edit again.')
  return mapRuns(html, (text, index) => (texts[index]!.trim() ? texts[index]! : text))
}

/** The person's words for each frame, in frame order, one string per text run. */
export const designTextEdit = z
  .array(z.array(z.string().max(2000)).max(1000))
  .min(1)
  .max(DESIGN_FRAMES_MAX)
export type DesignTextEdit = z.infer<typeof designTextEdit>
