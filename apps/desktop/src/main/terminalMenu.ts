import { t } from './localization'
import { clipboard, dialog, Menu, type BrowserWindow } from 'electron'

export type TerminalMenuResult = 'selectAll' | 'clear' | 'addToChat' | { paste: string } | null
export function terminalMenu(
  win: BrowserWindow,
  selection: string,
  point: { x: number; y: number },
  /** The command and output under the pointer; empty when the terminal has no command to offer. */
  block = '',
): Promise<TerminalMenuResult> {
  return new Promise((resolve) => {
    let chosen = false
    const failed = (error: unknown) => {
      resolve(null)
      void dialog.showMessageBox(win, { type: 'error', message: String(error) })
    }
    Menu.buildFromTemplate([
      {
        label: t('Copy'),
        enabled: !!selection,
        click: () => {
          void clipboard.writeText(selection).catch(failed)
        },
      },
      {
        label: t('Copy command and output'),
        visible: !!block,
        click: () => {
          void clipboard.writeText(block).catch(failed)
        },
      },
      {
        label: t('Paste'),
        click: () => {
          chosen = true
          void clipboard
            .readText()
            .then((paste) => {
              if (paste.length > 1_000_000) throw new Error('Clipboard text is too large to paste into the terminal')
              resolve({ paste })
            })
            .catch(failed)
        },
      },
      { label: t('Select all'), click: () => resolve('selectAll') },
      { type: 'separator' },
      {
        label: selection.trim() ? t('Add selection to chat') : t('Add screen to chat'),
        click: () => resolve('addToChat'),
      },
      { type: 'separator' },
      { label: t('Clear scrollback'), click: () => resolve('clear') },
    ]).popup({
      window: win,
      x: Math.round(point.x),
      y: Math.round(point.y),
      callback: () => {
        if (!chosen) resolve(null)
      },
    })
  })
}
