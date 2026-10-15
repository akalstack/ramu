import { useEffect, useState } from 'react'
import { Alert, TextInput, View } from 'react-native'
import { Archive, ArchiveRestore, Pencil, Pin, PinOff, Trash2 } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import type { Chat } from '../runtime/types'
import { useStore } from '../runtime/store'
import { Button, Row, Sheet, T } from './ui'

/** Long-press actions for a chat, as on the desktop's task context menu: pin, rename, archive, delete. */
export function ChatActionsSheet({ chat, open, onClose }: { chat: Chat; open: boolean; onClose: () => void }) {
  const { c } = useTheme()
  const store = useStore()
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(chat.title)
  useEffect(() => { if (open) { setRenaming(false); setTitle(chat.title) } }, [open, chat.title])
  const archived = chat.status === 'archived'
  const pinned = chat.pinnedAt !== null
  const run = async (fn: () => Promise<unknown>) => {
    onClose()
    try { await fn(); await store.refresh(chat.computerId) } catch (error) { Alert.alert('Could not update chat', error instanceof Error ? error.message : String(error)) }
  }
  const remove = (removeWorktrees: boolean) => void run(() => store.invoke(chat.computerId, 'tasks.delete', chat.taskId, removeWorktrees))
  const confirmDelete = () => {
    onClose()
    const worktree = chat.mode === 'worktree'
    Alert.alert('Delete chat?', `${chat.title}\n\nThis removes the chat from the computer. Files in the checkout stay.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove(false) },
      ...(worktree ? [{ text: 'Delete and remove worktree', style: 'destructive' as const, onPress: () => remove(true) }] : []),
    ])
  }
  const items = [
    { icon: pinned ? PinOff : Pin, label: pinned ? 'Unpin' : 'Pin to top', onPress: () => void run(() => store.invoke(chat.computerId, 'tasks.pin', chat.taskId, !pinned)) },
    { icon: Pencil, label: 'Rename', onPress: () => setRenaming(true) },
    { icon: archived ? ArchiveRestore : Archive, label: archived ? 'Unarchive' : 'Archive', onPress: () => void run(() => store.invoke(chat.computerId, 'tasks.archive', chat.taskId, !archived)) },
    { icon: Trash2, label: 'Delete…', danger: true, onPress: confirmDelete },
  ]
  return (
    <Sheet open={open} onClose={onClose} title={renaming ? 'Rename chat' : chat.title}>
      {renaming ? (
        <View style={{ padding: space.l, gap: space.m }}>
          <TextInput autoFocus value={title} onChangeText={setTitle} placeholder="Chat title" placeholderTextColor={c.placeholder} returnKeyType="done" onSubmitEditing={() => title.trim() && void run(() => store.invoke(chat.computerId, 'tasks.rename', chat.taskId, title.trim()))} style={{ color: c.text, fontSize: font.body, padding: space.m, borderRadius: radius.m, backgroundColor: c.raised2 }} />
          <View style={{ flexDirection: 'row', gap: space.s, justifyContent: 'flex-end' }}>
            <Button kind="ghost" title="Cancel" onPress={() => setRenaming(false)} />
            <Button title="Save" disabled={!title.trim() || title.trim() === chat.title} onPress={() => void run(() => store.invoke(chat.computerId, 'tasks.rename', chat.taskId, title.trim()))} />
          </View>
        </View>
      ) : items.map(item => (
        <Row key={item.label} onPress={item.onPress}>
          <item.icon size={18} color={item.danger ? c.bad : c.soft} />
          <T tone={item.danger ? 'bad' : 'text'}>{item.label}</T>
        </Row>
      ))}
    </Sheet>
  )
}
