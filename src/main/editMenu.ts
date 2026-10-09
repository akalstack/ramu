import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

/** Only text editing and selection get native menus; app actions keep their own menus. */
export function editMenuItems({ isEditable, selectionText, editFlags }: Pick<ContextMenuParams, 'isEditable' | 'selectionText' | 'editFlags'>): MenuItemConstructorOptions[] {
  if (!isEditable) return selectionText ? [{ role: 'copy', enabled: editFlags.canCopy }] : []
  return [
    { role: 'undo', enabled: editFlags.canUndo },
    { role: 'redo', enabled: editFlags.canRedo },
    { type: 'separator' },
    { role: 'cut', enabled: editFlags.canCut },
    { role: 'copy', enabled: editFlags.canCopy },
    { role: 'paste', enabled: editFlags.canPaste },
    { type: 'separator' },
    { role: 'selectAll', enabled: editFlags.canSelectAll },
  ]
}
