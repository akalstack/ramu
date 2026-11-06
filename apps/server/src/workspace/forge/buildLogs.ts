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

/**
 * The prompt that wakes the thread whose push broke the default branch. The fix goes on a new branch, since the
 * default branch only changes through a pull request the person merges.
 */
export function brokenBranchPrompt(sha: string, branch: string, sections: string[]): string {
  return [
    `CI failed on ${branch} after your push of ${sha.slice(0, 7)}.`,
    '',
    '<ramu-context>',
    ...sections,
    '',
    'Work out the cause from the logs and the code, and run the same check locally when you can.',
    `Commit the fix on a new branch from ${branch}. Do not push; I will review it and open a pull request from Source Control.`,
    'Reply briefly: what failed, why, and what you changed. If a failure is flaky or unrelated to the push, say so instead of changing code.',
    '</ramu-context>',
  ].join('\n')
}
