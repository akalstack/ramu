import { clipboard, dialog, Menu, type BrowserWindow } from 'electron'

export type TerminalMenuResult = 'selectAll' | 'clear' | { paste: string } | null
export function terminalMenu(win: BrowserWindow, selection: string, point: { x: number; y: number }): Promise<TerminalMenuResult> {
  return new Promise((resolve) => {
    let chosen = false
    const failed = (error: unknown) => { resolve(null); void dialog.showMessageBox(win, { type: 'error', message: String(error) }) }
    Menu.buildFromTemplate([
      { label: 'Copy', enabled: !!selection, click: () => { void clipboard.writeText(selection).catch(failed) } },
      { label: 'Paste', click: () => {
        chosen = true
        void clipboard.readText().then((paste) => { if (paste.length > 1_000_000) throw new Error('Clipboard text is too large to paste into the terminal'); resolve({ paste }) }).catch(failed)
      } },
      { label: 'Select all', click: () => resolve('selectAll') },
      { type: 'separator' },
      { label: 'Clear scrollback', click: () => resolve('clear') },
    ]).popup({ window: win, x: Math.round(point.x), y: Math.round(point.y), callback: () => { if (!chosen) resolve(null) } })
  })
}
