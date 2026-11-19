/** The newest live step is the useful headline; a failed step takes precedence over completed history. */
export function toolActivity<T>(tools: readonly T[], status: (tool: T) => 'running' | 'failed' | 'done') {
  const running = tools.filter((tool) => status(tool) === 'running')
  const failed = tools.filter((tool) => status(tool) === 'failed')
  return { current: running.at(-1) ?? failed.at(-1) ?? tools.at(-1), running: running.length, failed: failed.length }
}
