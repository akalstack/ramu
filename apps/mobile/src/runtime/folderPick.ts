/**
 * The folder browser screen chooses where a new project goes for whichever sheet opened it. One choice is waited for
 * at a time: a newer one answers the older with null, as leaving the screen without choosing does.
 */
let waiting: ((dir: string | null) => void) | null = null

/** Opens the browser with `open` (a route push) and resolves with the chosen folder, or null when none was chosen. */
export function pickFolder(open: () => void): Promise<string | null> {
  waiting?.(null)
  return new Promise((resolve) => {
    waiting = resolve
    open()
  })
}

/** The browser's answer; once answered, later calls do nothing. */
export function finishFolderPick(dir: string | null) {
  const resolve = waiting
  waiting = null
  resolve?.(dir)
}
