// The end of a failed build step's log, as a failing-build prompt carries it: enough to start from the error without
// opening the build, bounded so one noisy step cannot crowd out the rest.
const LOG_LINES = 60
const LOG_CHARS = 6000
/** Terminal colour codes, which build logs keep. */
const COLOURS = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
/** Failed steps read per build, and builds read per prompt. */
export const FAILED_STEPS = 3

/** A fenced block with the step's name and the tail of its log, or null for an empty log. */
export function failedStepLog(title: string, log: string): string | null {
  const tail = log.replace(COLOURS, '').split(/\r?\n/).slice(-LOG_LINES).join('\n').slice(-LOG_CHARS).trim()
  return tail ? `${title}:\n\`\`\`\n${tail}\n\`\`\`` : null
}
