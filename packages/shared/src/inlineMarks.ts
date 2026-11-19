// A line of Markdown split into runs a text field can style as it is typed: bold, italic, code and link text, with
// their markers kept (shown quietly), so editing the formatted text changes exactly the Markdown it shows.

export type InlineStyle = 'plain' | 'marker' | 'bold' | 'italic' | 'code' | 'link'

export interface InlineRun {
  text: string
  style: InlineStyle
}

const MARKS = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1|(\*|_)(?=\S)(.+?)(?<=\S)\3|(`+)(.+?)\5|\[([^\]\n]+)\]\(([^)\s]+)\)/g

/** The runs of one line; joined back together they are exactly the line. */
export function inlineRuns(line: string): InlineRun[] {
  const runs: InlineRun[] = []
  let at = 0
  const push = (text: string, style: InlineStyle) => {
    if (text) runs.push({ text, style })
  }
  for (const match of line.matchAll(MARKS)) {
    // Underscores inside a word (snake_case) are not emphasis in GitHub's Markdown.
    const marker = match[1] ?? match[3]
    const end = match.index! + match[0].length
    if (marker?.startsWith('_') && (/\w/.test(line[match.index! - 1] ?? '') || /\w/.test(line[end] ?? ''))) continue
    push(line.slice(at, match.index), 'plain')
    if (match[1]) {
      push(match[1], 'marker')
      push(match[2]!, 'bold')
      push(match[1], 'marker')
    } else if (match[3]) {
      push(match[3], 'marker')
      push(match[4]!, 'italic')
      push(match[3], 'marker')
    } else if (match[5]) {
      push(match[5], 'marker')
      push(match[6]!, 'code')
      push(match[5], 'marker')
    } else {
      push('[', 'marker')
      push(match[7]!, 'link')
      push(`](${match[8]})`, 'marker')
    }
    at = match.index! + match[0].length
  }
  push(line.slice(at), 'plain')
  return runs
}
