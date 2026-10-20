import { translate } from '@ramu/shared/i18n'
import { readRemovalCommands, removalReview, removalError } from '@ramu/shared/chat/taskRemoval'
import { useEffect, useRef, useState } from 'react'
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
import { useT } from '../i18n'
import { Button, Row, Sheet, T, type Icon } from './ui'
import { ProjectCommandSettings } from './ProjectCommandSettings'

/** Presents one review for the selected host; it never retries a deletion automatically. */
export async function confirmChatDeletion(
  store: Pick<ReturnType<typeof useStore>, 'invoke' | 'refresh' | 'language' | 'computers' | 'chats'>,
  chat: Chat,
  done?: () => void,
  isCurrent: () => boolean = () => true,
  presented?: () => void,
) {
  const t = (text: string) => translate(store.language, text)
  try {
    const commands = await readRemovalCommands(
      (method, taskId) => store.invoke(chat.computerId, method, taskId),
      chat.taskId,
    )
    if (!isCurrent()) return
    const unknown = commands.some((command) => command.state === 'unknown')
    const live = commands.some((command) => command.state !== 'unknown')
    const shared =
      !!chat.workspaceId &&
      store.chats.some(
        (other) =>
          other.computerId === chat.computerId &&
          other.taskId !== chat.taskId &&
          other.workspaceId === chat.workspaceId,
      )
    const canRemoveWorktree = chat.mode === 'worktree' && !unknown && !shared
    let deleting = false
    const remove = async (removeWorktrees: boolean) => {
      if (deleting) return
      deleting = true
      try {
        if (commands.length)
          await store.invoke(chat.computerId, 'tasks.delete', chat.taskId, removeWorktrees, removalReview(commands))
        else await store.invoke(chat.computerId, 'tasks.delete', chat.taskId, removeWorktrees)
        await store.refresh(chat.computerId)
        done?.()
      } catch (error) {
        Alert.alert(t('Could not update thread'), t(removalError(error)))
      }
    }
    const host = store.computers.find((computer) => computer.id === chat.computerId)?.name ?? chat.computerId
    const message = [
      chat.title,
      host,
      t(
        canRemoveWorktree
          ? 'This removes the thread from the host. Choose whether to keep its worktree. Branches are kept.'
          : 'This removes the thread from the host. Files in the checkout stay.',
      ),
      ...commands.map(
        (command) =>
          `${command.command} · ${t(command.state === 'unknown' ? 'Unknown' : command.state === 'stopping' ? 'Stopping' : 'Running')}`,
      ),
      ...(live
        ? [
            t(
              'Background commands must stop before deletion. If one keeps running, the thread is kept so you can inspect or force stop it.',
            ),
          ]
        : []),
      ...(unknown
        ? [
            t(
              'Unknown commands cannot be stopped from these records. Deleting forgets their saved output and keeps the checkout files. Verify those commands on the host.',
            ),
          ]
        : []),
    ].join('\n\n')
    presented?.()
    Alert.alert(t('Delete thread?'), message, [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t(
          live
            ? unknown
              ? 'Stop known commands and delete thread'
              : 'Stop commands and delete thread'
            : unknown
              ? 'Delete thread and forget records'
              : 'Delete',
        ),
        style: 'destructive',
        onPress: () => {
          void remove(false)
        },
      },
      ...(canRemoveWorktree
        ? [
            {
              text: t('Delete and remove worktree'),
              style: 'destructive' as const,
              onPress: () => {
                void remove(true)
              },
            },
          ]
        : []),
    ])
  } catch (error) {
    if (isCurrent()) Alert.alert(t('Could not update thread'), error instanceof Error ? error.message : String(error))
  }
}

/** One-shot pin/archive commands shared by the row's swipe actions. */
export function useChatCommands(chat: Chat) {
  const store = useStore()
  const revision = useRef(0)
  const loading = useRef(false)
  useEffect(
    () => () => {
      revision.current++
      loading.current = false
    },
    [chat.computerId, chat.taskId],
  )
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
    confirmDelete: (done?: () => void, presented?: () => void) => {
      if (loading.current) return
      loading.current = true
      const mine = revision.current
      void confirmChatDeletion(store, chat, done, () => revision.current === mine, presented).finally(() => {
        if (revision.current === mine) loading.current = false
      })
    },
  }
}

/** Long-press actions for a chat, as on the desktop's task context menu: pin, rename, archive, delete. */
export function ChatActionsSheet({
  chat,
  open,
  onClose,
  rename = false,
  extras = [],
  onGone,
}: {
  chat: Chat
  open: boolean
  onClose: () => void
  rename?: boolean
  /** Screen-specific actions listed above the shared ones; each runs once the sheet has closed. */
  extras?: { icon: Icon; label: string; onPress?: () => void }[]
  /** Runs once the thread is deleted or archived, so a thread screen can leave itself. */
  onGone?: () => void
}) {
  const { c } = useTheme()
  const store = useStore()
  const t = useT()
  const [naming, setNaming] = useState(false)
  const titleRequest = useRef(false)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(chat.title)
  useEffect(() => {
    if (open) {
      setRenaming(rename)
      setTitle(chat.title)
    }
  }, [open, rename, chat.title])
  const commands = useChatCommands(chat)
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
  const confirmDelete = () => commands.confirmDelete(onGone, onClose)
  const items: { icon: Icon; label: string; danger?: boolean; onPress?: () => void }[] = [
    ...extras.map((extra) => ({
      ...extra,
      onPress: extra.onPress
        ? () => {
            onClose()
            setTimeout(extra.onPress!, 300)
          }
        : undefined,
    })),
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
            label:
              naming || chat.titleGenerationState === 'pending'
                ? t.namingThread
                : chat.titleGenerationState === 'failed'
                  ? t.retryTitleGeneration
                  : t.renameWithAI,
            onPress:
              naming || chat.titleGenerationState === 'pending' || !store.isOnline(chat.computerId)
                ? undefined
                : () => {
                    if (titleRequest.current) return
                    titleRequest.current = true
                    setNaming(true)
                    void run(() =>
                      store.invoke(chat.computerId, 'tasks.generateTitle', chat.taskId, chat.settings!, true),
                    ).finally(() => {
                      titleRequest.current = false
                      setNaming(false)
                    })
                  },
          },
        ]
      : []),
    {
      icon: archived ? ArchiveRestore : Archive,
      label: archived ? 'Unarchive' : 'Archive',
      onPress: () =>
        void run(async () => {
          await store.invoke(chat.computerId, 'tasks.archive', chat.taskId, !archived)
          if (!archived) onGone?.()
        }),
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
          <Row
            key={item.label}
            onPress={item.onPress}
            accessibilityRole="button"
            accessibilityState={{
              disabled: !item.onPress,
              busy: item.icon === Sparkles && (naming || chat.titleGenerationState === 'pending'),
            }}
          >
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
  const t = useT()
  const router = useRouter()
  const [managingActions, setManagingActions] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(project.name)
  useEffect(() => {
    if (open) {
      setManagingActions(false)
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
      icon: SquareTerminal,
      label: t.manageProjectActions,
      onPress: () => setManagingActions(true),
    },
    {
      icon: FolderSearch,
      label: 'Browse files',
      onPress: () =>
        later(() =>
          router.push({ pathname: '/explorer', params: { computer: project.computerId, ctx: `project:${raw}` } }),
        ),
    },
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
        Alert.alert('Remove project?', `${project.name}\n\nIts threads and folders on the host are not deleted.`, [
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
  if (managingActions)
    return (
      <ProjectCommandSettings
        key={`${project.computerId}:${raw}`}
        hostId={project.computerId}
        projectId={raw}
        projectName={project.name}
        open={open}
        onClose={onClose}
      />
    )
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
          <Row
            key={item.label}
            onPress={item.onPress}
            accessibilityRole="button"
            accessibilityState={{
              disabled: !item.onPress,
            }}
          >
            <item.icon size={18} color={'danger' in item && item.danger ? c.bad : c.soft} />
            <T tone={'danger' in item && item.danger ? 'bad' : 'text'}>{item.label}</T>
          </Row>
        ))
      )}
    </Sheet>
  )
}
