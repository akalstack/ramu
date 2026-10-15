import { diffLines } from 'diff'
import type { ChangedFile, DiffLine } from './types'
export function changedFile(path: string, repo: string, original: string, modified: string): ChangedFile {
  let old = 1, next = 1, additions = 0, deletions = 0
  const lines: DiffLine[] = []
  for (const chunk of diffLines(original, modified)) {
    const texts = chunk.value.replace(/\n$/, '').split('\n')
    if (chunk.added) additions += texts.length
    if (chunk.removed) deletions += texts.length
    // Collapse large unchanged sections, keeping enough context to orient the reader.
    for (let index = 0; index < texts.length; index++) {
      const text = texts[index]!
      if (!chunk.added && !chunk.removed && texts.length > 12 && index === 4) {
        const skip = texts.length - 8
        lines.push({ type: 'hunk', text: `… ${skip} unchanged lines …` }); old += skip; next += skip; index += skip - 1; continue
      }
      lines.push(chunk.added ? { type: 'add', text, new: next++ } : chunk.removed ? { type: 'del', text, old: old++ } : { type: 'ctx', text, old: old++, new: next++ })
    }
  }
  return { path, repo, status: !original ? 'added' : !modified ? 'deleted' : 'modified', additions, deletions, lines }
}
