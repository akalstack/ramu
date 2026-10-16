import { useEffect, useState } from 'react'
import { Alert, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import {
  Archive,
  ArchiveRestore,
  Copy,
  FolderSearch,
  Pencil,
  Pin,
  PinOff,
  SquarePen,
  SquareTerminal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react-native'
import { useRouter } from 'expo-router'
import type { MobileProject } from '../runtime/types'
import { font, radius, space, useTheme } from '../theme'
import type { Chat } from '../runtime/types'
import { useStore } from '../runtime/store'
import { Button, Row, Sheet, T } from './ui'

/** One-shot pin/archive commands shared by the row's swipe actions. */
export function useChatCommands(chat: Chat) {
  const store = useStore()
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await store.refresh(chat.computerId)
    } catch (error) {
      Alert.alert('Could not update thread', error instanceof Error ? error.message : String(error))
    }
  }
  return {
    pinned: chat.pinnedAt !== null,
    archived: chat.status === 'archived',
    togglePin: () => run(() => store.invoke(chat.computerId, 'tasks.pin', chat.taskId, chat.pinnedAt === null)),
    toggleArchive: () =>
      run(() => store.invoke(chat.computerId, 'tasks.archive', chat.taskId, chat.status !== 'archived')),
    /** Asks first; `done` runs after the chat is gone (a chat screen leaves itself). */
    confirmDelete: (done?: () => void) => {
      const remove = (removeWorktrees: boolean) =>
        void run(async () => {
          await store.invoke(chat.computerId, 'tasks.delete', chat.taskId, removeWorktrees)
          done?.()
        })
      Alert.alert(
        'Delete thread?',
        `${chat.title}\n\nThis removes the thread from the computer. Files in the checkout stay.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => remove(false) },
          ...(chat.mode === 'worktree'
            ? [{ text: 'Delete and remove worktree', style: 'destructive' as const, onPress: () => remove(true) }]
            : []),
        ],
      )
    },
  }
}

/** Long-press actions for a chat, as on the desktop's task context menu: pin, rename, archive, delete. */
export function ChatActionsSheet({
  chat,
  open,
  onClose,
  rename = false,
}: {
  chat: Chat
  open: boolean
  onClose: () => void
  rename?: boolean
}) {
  const { c } = useTheme()
  const store = useStore()
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(chat.title)
  useEffect(() => {
    if (open) {
      setRenaming(rename)
      setTitle(chat.title)
    }
  }, [open, rename, chat.title])
  const archived = chat.status === 'archived'
  const pinned = chat.pinnedAt !== null
  const run = async (fn: () => Promise<unknown>) => {
    onClose()
    try {
      await fn()
      await store.refresh(chat.computerId)
    } catch (error) {
      Alert.alert('Could not update thread', error instanceof Error ? error.message : String(error))
    }
  }
  const remove = (removeWorktrees: boolean) =>
    void run(() => store.invoke(chat.computerId, 'tasks.delete', chat.taskId, removeWorktrees))
  const confirmDelete = () => {
    onClose()
    const worktree = chat.mode === 'worktree'
    Alert.alert(
      'Delete thread?',
      `${chat.title}\n\nThis removes the thread from the computer. Files in the checkout stay.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => remove(false) },
        ...(worktree
          ? [{ text: 'Delete and remove worktree', style: 'destructive' as const, onPress: () => remove(true) }]
          : []),
      ],
    )
  }
  const items = [
    {
      icon: pinned ? PinOff : Pin,
      label: pinned ? 'Unpin' : 'Pin to top',
      onPress: () => void run(() => store.invoke(chat.computerId, 'tasks.pin', chat.taskId, !pinned)),
    },
    {
      icon: Copy,
      label: 'Copy thread ID',
      onPress: () => {
        onClose()
        void Clipboard.setStringAsync(chat.taskId)
      },
    },
    { icon: Pencil, label: 'Rename', onPress: () => setRenaming(true) },
    ...(chat.settings
      ? [
          {
            icon: Sparkles,
            label: 'Rename with AI',
            onPress: () =>
              void run(() => store.invoke(chat.computerId, 'tasks.generateTitle', chat.taskId, chat.settings!, true)),
          },
        ]
      : []),
    {
      icon: archived ? ArchiveRestore : Archive,
      label: archived ? 'Unarchive' : 'Archive',
      onPress: () => void run(() => store.invoke(chat.computerId, 'tasks.archive', chat.taskId, !archived)),
    },
    { icon: Trash2, label: 'Delete…', danger: true, onPress: confirmDelete },
  ]
  return (
    <Sheet open={open} onClose={onClose} title={renaming ? 'Rename thread' : chat.title}>
      {renaming ? (
        <View style={{ padding: space.l, gap: space.m }}>
          <TextInput
            autoFocus
            value={title}
            onChangeText={setTitle}
            placeholder="Thread title"
            placeholderTextColor={c.placeholder}
            returnKeyType="done"
            onSubmitEditing={() =>
              title.trim() && void run(() => store.invoke(chat.computerId, 'tasks.rename', chat.taskId, title.trim()))
            }
            style={{
              color: c.text,
              fontSize: font.body,
              padding: space.m,
              borderRadius: radius.m,
              backgroundColor: c.raised2,
            }}
          />
          <View style={{ flexDirection: 'row', gap: space.s, justifyContent: 'flex-end' }}>
            <Button kind="ghost" title="Cancel" onPress={() => setRenaming(false)} />
            <Button
              title="Save"
              disabled={!title.trim() || title.trim() === chat.title}
              onPress={() => void run(() => store.invoke(chat.computerId, 'tasks.rename', chat.taskId, title.trim()))}
            />
          </View>
        </View>
      ) : (
        items.map((item) => (
          <Row key={item.label} onPress={item.onPress}>
            <item.icon size={18} color={item.danger ? c.bad : c.soft} />
            <T tone={item.danger ? 'bad' : 'text'}>{item.label}</T>
          </Row>
        ))
      )}
    </Sheet>
  )
}

/** Long-press actions for a project, as on the desktop's project menu: new chat, rename, terminal, remove. */
export function ProjectActionsSheet({
  project,
  open,
  onClose,
}: {
  project: MobileProject
  open: boolean
  onClose: () => void
}) {
  const { c } = useTheme()
  const store = useStore()
  const router = useRouter()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(project.name)
  useEffect(() => {
    if (open) {
      setRenaming(false)
      setName(project.name)
    }
  }, [open, project.name])
  const raw = project.id.slice(project.id.indexOf(':') + 1)
  const run = async (fn: () => Promise<unknown>) => {
    onClose()
    try {
      await fn()
      await store.refresh(project.computerId)
    } catch (error) {
      Alert.alert('Could not update project', error instanceof Error ? error.message : String(error))
    }
  }
  const later = (fn: () => void) => {
    onClose()
    setTimeout(fn, 300)
  }
  const items = [
    {
      icon: SquarePen,
      label: 'New thread',
      onPress: () => later(() => router.push({ pathname: '/new', params: { project: project.id } })),
    },
    { icon: Pencil, label: 'Rename', onPress: () => setRenaming(true) },
    {
      icon: SquareTerminal,
      label: 'Open terminal',
      onPress: () =>
        later(() =>
          router.push({ pathname: '/terminal', params: { computer: project.computerId, ctx: `project:${raw}` } }),
        ),
    },
    {
      icon: FolderSearch,
      label: 'Copy folder path',
      onPress: () => {
        onClose()
        if (project.root) void Clipboard.setStringAsync(project.root)
      },
    },
    {
      icon: X,
      label: 'Remove project…',
      danger: true,
      onPress: () => {
        onClose()
        Alert.alert('Remove project?', `${project.name}\n\nIts threads and folders on the computer are not deleted.`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => void run(() => store.invoke(project.computerId, 'projects.remove', raw)),
          },
        ])
      },
    },
  ]
  return (
    <Sheet open={open} onClose={onClose} title={renaming ? 'Rename project' : project.name}>
      {renaming ? (
        <View style={{ padding: space.l, gap: space.m }}>
          <TextInput
            autoFocus
            value={name}
            onChangeText={setName}
            placeholder="Project name"
            placeholderTextColor={c.placeholder}
            returnKeyType="done"
            onSubmitEditing={() =>
              name.trim() && void run(() => store.invoke(project.computerId, 'projects.rename', raw, name.trim()))
            }
            style={{
              color: c.text,
              fontSize: font.body,
              padding: space.m,
              borderRadius: radius.m,
              backgroundColor: c.raised2,
            }}
          />
          <View style={{ flexDirection: 'row', gap: space.s, justifyContent: 'flex-end' }}>
            <Button kind="ghost" title="Cancel" onPress={() => setRenaming(false)} />
            <Button
              title="Save"
              disabled={!name.trim() || name.trim() === project.name}
              onPress={() => void run(() => store.invoke(project.computerId, 'projects.rename', raw, name.trim()))}
            />
          </View>
        </View>
      ) : (
        items.map((item) => (
          <Row key={item.label} onPress={item.onPress}>
            <item.icon size={18} color={'danger' in item && item.danger ? c.bad : c.soft} />
            <T tone={'danger' in item && item.danger ? 'bad' : 'text'}>{item.label}</T>
          </Row>
        ))
      )}
    </Sheet>
  )
}
