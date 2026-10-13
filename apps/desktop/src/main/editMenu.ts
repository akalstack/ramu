import { desktopLanguage, t } from './localization'
import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

/** Only text editing and selection get native menus; app actions keep their own menus. */
export function editMenuItems({ isEditable, selectionText, editFlags }: Pick<ContextMenuParams, 'isEditable' | 'selectionText' | 'editFlags'>): MenuItemConstructorOptions[] {
  const label = (source: string) => desktopLanguage() === 'id' ? { label: t(source) } : {}
  if (!isEditable) return selectionText ? [{ ...label('Copy'), role: 'copy', enabled: editFlags.canCopy }] : []
  return [
    { ...label('Undo'), role: 'undo', enabled: editFlags.canUndo },
    { ...label('Redo'), role: 'redo', enabled: editFlags.canRedo },
    { type: 'separator' },
    { ...label('Cut'), role: 'cut', enabled: editFlags.canCut },
    { ...label('Copy'), role: 'copy', enabled: editFlags.canCopy },
    { ...label('Paste'), role: 'paste', enabled: editFlags.canPaste },
    { type: 'separator' },
    { ...label('Select all'), role: 'selectAll', enabled: editFlags.canSelectAll },
  ]
}
