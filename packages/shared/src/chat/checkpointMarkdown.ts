const LABELS: [RegExp, string][] = [
  [/^(?:objective|goal)$/i, 'Objective'],
  [/^(?:completed|done|completed work)$/i, 'Done'],
  [/^(?:verification|verified|pending verification)$/i, 'Verified'],
  [/^(?:unresolved|unresolved issues|open|open issues|pending)$/i, 'Open'],
  [/^(?:next|next actions|next steps)$/i, 'Next'],
]
const LABEL =
  /(?:^|(?<=[.!?]\s))(Objective|Goal|Completed work|Completed|Done|Pending verification|Verification|Verified|Unresolved issues|Unresolved|Open issues|Open|Pending|Next actions|Next steps|Next):\s/g

/**
 * Checkpoints are written as Markdown sections; ones saved earlier are one paragraph of "Objective: … Completed: …".
 * Those read as a wall of text, so their labels become headings and their sentences bullets. The text itself is kept.
 */
export function checkpointMarkdown(summary: string): string {
  if (/^#{1,6} /m.test(summary)) return summary
  const labels = [...summary.matchAll(LABEL)]
  if (labels.length < 2) return summary
  const sections = labels.map((match, index) => {
    const body = summary.slice(match.index + match[0].length, labels[index + 1]?.index ?? summary.length).trim()
    const sentences = body.split(/(?<=[.!?])\s+(?=[A-Z])/)
    const title = LABELS.find(([pattern]) => pattern.test(match[1]!))![1]
    return `## ${title}\n\n${sentences.length > 1 ? sentences.map((line) => `- ${line}`).join('\n') : body}`
  })
  const lead = summary.slice(0, labels[0]!.index).trim()
  return [...(lead ? [lead] : []), ...sections].join('\n\n')
}
