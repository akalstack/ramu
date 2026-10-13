import { describe, expect, it } from 'vitest'
import { editMenuItems } from '../src/main/editMenu'

const editFlags = { canUndo: false, canRedo: false, canCut: false, canCopy: true, canPaste: true, canDelete: false, canSelectAll: true, canEditRichly: false }

describe('native text context menu', () => {
  it('leaves unselected app surfaces to their own menus', () => {
    expect(editMenuItems({ isEditable: false, selectionText: '', editFlags })).toEqual([])
  })
  it('offers only copy for a transcript selection', () => {
    expect(editMenuItems({ isEditable: false, selectionText: 'Selected reply', editFlags })).toEqual([{ role: 'copy', enabled: true }])
  })
  it('uses editing capabilities so an empty field still offers paste', () => {
    const items = editMenuItems({ isEditable: true, selectionText: '', editFlags })
    expect(items.find((item) => item.role === 'paste')?.enabled).toBe(true)
    expect(items.find((item) => item.role === 'cut')?.enabled).toBe(false)
    expect(items.find((item) => item.role === 'undo')?.enabled).toBe(false)
    expect(items.find((item) => item.role === 'selectAll')?.enabled).toBe(true)
  })
})
