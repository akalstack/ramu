import { t } from './localization'
import { clipboard, ClipboardItem, dialog, Menu, nativeImage, shell, type BrowserWindow } from 'electron'
import { copyFile } from 'node:fs/promises'
import { AttachmentStore } from './attachments'

export function attachmentActions(win: BrowserWindow, store: AttachmentStore) {
  const save = async (id: string) => {
    const file = store.get(id)
    const result = await dialog.showSaveDialog(win, { title: t('Save attachment'), defaultPath: file.name })
    if (result.canceled || !result.filePath) return false
    await copyFile(file.path, result.filePath)
    return true
  }
  const copy = async (id: string) => {
    const file = store.get(id)
    if (file.mimeType.startsWith('image/')) {
      const image = nativeImage.createFromPath(file.path)
      if (image.isEmpty()) throw new Error('This image could not be copied')
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
    } else await clipboard.writeText(file.name)
  }
  const reveal = (id: string) => shell.showItemInFolder(store.get(id).path)
  const menu = (id: string, removable: boolean, point: { x: number; y: number }) => {
    const file = store.get(id)
    return new Promise<'preview' | 'remove' | null>((resolve) => {
      Menu.buildFromTemplate([
        { label: t('Preview'), click: () => resolve('preview') },
        { label: file.mimeType.startsWith('image/') ? t('Copy image') : t('Copy filename'), click: () => { void copy(id).catch((error) => dialog.showMessageBox(win, { type: 'error', message: String(error) })) } },
        { label: t('Save as…'), click: () => { void save(id).catch((error) => dialog.showMessageBox(win, { type: 'error', message: String(error) })) } },
        { label: process.platform === 'darwin' ? t('Reveal in Finder') : t('Show in folder'), click: () => reveal(id) },
        ...(removable ? [{ type: 'separator' as const }, { label: t('Remove attachment'), click: () => resolve('remove') }] : []),
      ]).popup({ window: win, x: Math.round(point.x), y: Math.round(point.y), callback: () => resolve(null) })
    })
  }
  return { save, copy, reveal, menu }
}
