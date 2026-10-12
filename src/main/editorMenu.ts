import { t } from './localization'
import { clipboard, dialog, Menu, type BrowserWindow } from 'electron'

export interface EditorMenuOptions { selection: string; editable: boolean; comment: boolean; definition: boolean; references: boolean; rename: boolean; format: boolean }
export type EditorMenuResult = 'cut' | 'undo' | 'redo' | 'selectAll' | 'find' | 'definition' | 'references' | 'rename' | 'format' | 'comment' | { paste: string } | null
export function editorMenu(win: BrowserWindow, options: EditorMenuOptions, point: { x: number; y: number }): Promise<EditorMenuResult> {
  return new Promise((resolve) => {
    let chosen = false
    const perform = (operation: () => Promise<EditorMenuResult>) => { chosen = true; void operation().then(resolve, (error) => { resolve(null); void dialog.showMessageBox(win, { type: 'error', message: String(error) }) }) }
    Menu.buildFromTemplate([
      ...(options.comment ? [{ label: t('Add review comment'), click: () => resolve('comment') }, { type: 'separator' as const }] : []),
      ...(options.editable ? [{ label: t('Undo'), click: () => resolve('undo') }, { label: t('Redo'), click: () => resolve('redo') }, { type: 'separator' as const }, { label: t('Cut'), enabled: !!options.selection, click: () => perform(async () => { await clipboard.writeText(options.selection); return 'cut' }) }] : []),
      { label: t('Copy'), enabled: !!options.selection, click: () => perform(async () => { await clipboard.writeText(options.selection); return null }) },
      ...(options.editable ? [{ label: t('Paste'), click: () => perform(async () => { const paste = await clipboard.readText(); if (paste.length > 1_000_000) throw new Error('Clipboard text is too large'); return { paste } }) }] : []),
      { label: t('Select all'), click: () => resolve('selectAll') },
      { type: 'separator' },
      { label: t('Find'), click: () => resolve('find') },
      ...(options.definition ? [{ label: t('Go to definition'), click: () => resolve('definition') }] : []),
      ...(options.references ? [{ label: t('Find references'), click: () => resolve('references') }] : []),
      ...(options.rename && options.editable ? [{ label: t('Rename symbol'), click: () => resolve('rename') }] : []),
      ...(options.format && options.editable ? [{ type: 'separator' as const }, { label: t('Format document'), click: () => resolve('format') }] : []),
    ]).popup({ window: win, x: Math.round(point.x), y: Math.round(point.y), callback: () => { if (!chosen) resolve(null) } })
  })
}
