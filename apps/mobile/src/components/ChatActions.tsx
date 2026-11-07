import { SheetGroup, SheetOption } from './SheetOptions'
import { threadStatus, titleSourceNote } from '@ramu/shared/chat/threadStatus'
import { threadOriginLabel } from '@ramu/shared/workspace/threadOrigin'
import { runsBy } from '../runtime/groupRuns'
import { translate } from '@ramu/shared/i18n'
import { readRemovalCommands, removalReview, removalError } from '@ramu/shared/chat/taskRemoval'
import { useEffect, useRef, useState } from 'react'
import { Alert, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import {
  Archive,
  ArchiveRestore,
  Copy,
  Rocket,
  FolderSearch,
  ListChecks,
  Pencil,
  Pin,
  PinOff,
  SquarePen,
  SquareTerminal,
  Sparkles,
  Trash2,
} from 'lucide-react-native'
import { useRouter } from 'expo-router'
import type { MobileProject } from '../runtime/types'
import { font, radius, space, useTheme } from '../theme'
import type { Chat } from '../runtime/types'
import { useStore } from '../runtime/store'
import { showError, showToast } from '../runtime/toast'
import { VIEW_ONLY_WRITE_NOTICE } from '../runtime/viewerAccess'
import { useT } from '../i18n'
import { Button, Sheet, T, type Icon } from './ui'
import { ProjectCommandSettings } from './ProjectCommandSettings'
import { ProjectDeployments } from './ProjectDeployments'
import { ProjectRoutingSettings } from './ProjectRoutingSettings'
import { useBulkThreadActions } from './BulkThreadActions'

/** Presents one review for the selected host; it never retries a deletion automatically. */
export async function confirmChatDeletion(
  store: Pick<ReturnType<typeof useStore>, 'invoke' | 'refresh' | 'language' | 'computers' | 'chats'>,
  chat: Chat,
  done?: () => void,
  isCurrent: () => boolean = () => true,
  presented?: () => void,
) {
  const t = (text: string) => translate(store.language, text)
  const viewer = () => store.computers.find((host) => host.id === chat.computerId)?.access === 'viewer'
  if (viewer() || !isCurrent()) return
  try {
    const commands = await readRemovalCommands(
      (method, taskId) => store.invoke(chat.computerId, method, taskId),
      chat.taskId,
    )
    if (!isCurrent() || viewer()) return
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
      if (deleting || !isCurrent() || viewer()) return
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

/**
 * Offers to bring a thread back after it left the list (marked done or archived). Pinning, reopening and unarchiving
 * stay where you can see them, so they get no toast.
 */
export function offerThreadUndo(store: ReturnType<typeof useStore>, chat: Chat, kind: 'done' | 'archived') {
  showToast(kind === 'done' ? 'recapDone' : 'threadArchived', {
    label: 'undo',
    run: () => {
      void store
        .invoke(chat.computerId, kind === 'done' ? 'tasks.done' : 'tasks.archive', chat.taskId, false)
        .then(() => store.refresh(chat.computerId))
        .catch((error) => showError(error instanceof Error ? error.message : String(error)))
    },
  })
}

/** One-shot pin/done/archive commands shared by the row's swipe actions. */
export function useChatCommands(chat: Chat) {
  const store = useStore()
  const latestStore = useRef(store)
  latestStore.current = store
  const revision = useRef(0)
  const loading = useRef(false)
  useEffect(
    () => () => {
      revision.current++
      loading.current = false
    },
    [chat.computerId, chat.taskId],
  )
  const writable = () =>
    latestStore.current.isOnline(chat.computerId) &&
    latestStore.current.computers?.find((host) => host.id === chat.computerId)?.access !== 'viewer'
  const run = async (fn: () => Promise<unknown>) => {
    if (!writable()) return
    try {
      await fn()
      await store.refresh(chat.computerId)
    } catch (error) {
      Alert.alert('Could not update thread', error instanceof Error ? error.message : String(error))
    }
  }
  return {
    viewOnly: store.computers?.find((host) => host.id === chat.computerId)?.access === 'viewer',
    pinned: chat.pinnedAt !== null,
    archived: chat.status === 'archived',
    done: !!chat.doneAt,
    togglePin: () => run(() => store.invoke(chat.computerId, 'tasks.pin', chat.taskId, chat.pinnedAt === null)),
    toggleDone: () =>
      run(async () => {
        await store.invoke(chat.computerId, 'tasks.done', chat.taskId, !chat.doneAt)
        if (!chat.doneAt) offerThreadUndo(latestStore.current, chat, 'done')
      }),
    toggleArchive: () =>
      run(async () => {
        const archiving = chat.status !== 'archived'
        await store.invoke(chat.computerId, 'tasks.archive', chat.taskId, archiving)
        if (archiving) offerThreadUndo(latestStore.current, chat, 'archived')
      }),
    /** Asks first; `done` runs after the chat is gone (a chat screen leaves itself). */
    confirmDelete: (done?: () => void, presented?: () => void) => {
      if (!writable() || loading.current) return
      loading.current = true
      const mine = revision.current
      void confirmChatDeletion(store, chat, done, () => revision.current === mine && writable(), presented).finally(
        () => {
          if (revision.current === mine) loading.current = false
        },
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
  extras = [],
  onGone,
}: {
  chat: Chat
  open: boolean
  onClose: () => void
  rename?: boolean
  /** Screen-specific actions listed above the shared ones; each runs once the sheet has closed. Each `group` is set apart by a divider. */
  extras?: { icon: Icon; label: string; onPress?: () => void; group?: string }[]
  /** Runs once the thread is deleted or archived, so a thread screen can leave itself. */
  onGone?: () => void
}) {
  const { c } = useTheme()
  const store = useStore()
  const latestStore = useRef(store)
  latestStore.current = store
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
  const viewOnly = store.computers?.find((host) => host.id === chat.computerId)?.access === 'viewer'
  const writable = () =>
    latestStore.current.isOnline(chat.computerId) &&
    latestStore.current.computers?.find((host) => host.id === chat.computerId)?.access !== 'viewer'
  const commands = useChatCommands(chat)
  const say = (text: string, values?: Record<string, string | number>) => translate(store.language, text, values)
  const archived = chat.status === 'archived'
  const pinned = chat.pinnedAt !== null
  const run = async (fn: () => Promise<unknown>) => {
    if (!writable()) return
    onClose()
    try {
      await fn()
      await store.refresh(chat.computerId)
    } catch (error) {
      Alert.alert('Could not update thread', error instanceof Error ? error.message : String(error))
    }
  }
  const confirmDelete = () => commands.confirmDelete(onGone, onClose)
  const items: { icon: Icon; label: string; danger?: boolean; onPress?: () => void; group?: string }[] = [
    ...extras.map((extra) => ({
      group: 'screen',
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
      label: say(pinned ? 'Unpin' : 'Pin to top'),
      onPress: () => void run(() => store.invoke(chat.computerId, 'tasks.pin', chat.taskId, !pinned)),
    },
    {
      icon: Copy,
      label: say('Copy thread ID'),
      onPress: () => {
        onClose()
        void Clipboard.setStringAsync(chat.taskId)
      },
    },
    {
      icon: Pencil,
      label: say('Rename'),
      onPress: () => {
        if (writable()) setRenaming(true)
      },
    },
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
                    if (!writable() || titleRequest.current) return
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
      label: say(archived ? 'Unarchive' : 'Archive'),
      onPress: () =>
        void run(async () => {
          await store.invoke(chat.computerId, 'tasks.archive', chat.taskId, !archived)
          if (!archived) {
            offerThreadUndo(store, chat, 'archived')
            onGone?.()
          }
        }),
    },
    { icon: Trash2, label: say('Delete…'), danger: true, onPress: confirmDelete, group: 'danger' },
  ]
  const visible = items.filter(
    (item) => !viewOnly || item.icon === Copy || extras.some((extra) => extra.label === item.label),
  )
  const status = threadStatus(chat, false, chat.goal && { ...chat.goal, verifying: !!chat.goal.claim })
  const about = [
    status && status.full !== status.short ? say(status.full) : null,
    status?.next ? say(status.next) : null,
    chat.startedFrom ? threadOriginLabel(chat.startedFrom, say) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Sheet open={open} onClose={onClose} title={renaming ? say('Rename thread') : chat.title}>
      {viewOnly ? <T tone="muted">{VIEW_ONLY_WRITE_NOTICE[store.language]}</T> : null}
      {renaming ? (
        <View style={{ padding: space.l, gap: space.m }}>
          <TextInput
            autoFocus
            editable={!viewOnly}
            value={title}
            onChangeText={setTitle}
            placeholder={say('Thread title')}
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
          {titleSourceNote(chat.titleSource) ? (
            <T size={font.caption} tone="muted">
              {say(titleSourceNote(chat.titleSource)!)}
            </T>
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.s, justifyContent: 'flex-end' }}>
            <Button kind="ghost" title={say('Cancel')} onPress={() => setRenaming(false)} />
            <Button
              title={say('Save')}
              disabled={viewOnly || !title.trim() || title.trim() === chat.title}
              onPress={() => void run(() => store.invoke(chat.computerId, 'tasks.rename', chat.taskId, title.trim()))}
            />
          </View>
        </View>
      ) : (
        <>
          {/* What the desktop's hover card says: where the thread stands, what lets it go on, and who started it. */}
          {about ? (
            <T size={font.caption} tone="muted" style={{ paddingHorizontal: space.l + 4, paddingTop: space.s }}>
              {about}
            </T>
          ) : null}
          {runsBy(visible, (item) => item.group ?? 'thread').map((run) => (
            <SheetGroup key={run[0]!.label}>
              {run.map((item) => (
                <SheetOption
                  key={item.label}
                  icon={item.icon}
                  title={item.label}
                  danger={item.danger}
                  disabled={
                    !item.onPress || (item.icon === Sparkles && (naming || chat.titleGenerationState === 'pending'))
                  }
                  onPress={item.onPress}
                />
              ))}
            </SheetGroup>
          ))}
        </>
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
  const scope = `${project.computerId}:${project.id}`
  const latest = useRef({ store, scope })
  latest.current = { store, scope }
  const viewOnly = store.computers?.find((host) => host.id === project.computerId)?.access === 'viewer'
  const writable = () =>
    latest.current.scope === scope &&
    latest.current.store.isOnline(project.computerId) &&
    latest.current.store.computers?.find((host) => host.id === project.computerId)?.access !== 'viewer'
  const t = useT()
  const router = useRouter()
  const [managingActions, setManagingActions] = useState(false)
  const [routing, setRouting] = useState(false)
  const [deployments, setDeployments] = useState(false)
  const bulk = useBulkThreadActions()
  // As on the desktop: the project's open threads, leaving pinned and done ones where they are. Undo is on the toast.
  const archivable = store.chats.filter(
    (chat) =>
      chat.computerId === project.computerId &&
      chat.projectId === project.id &&
      chat.status !== 'archived' &&
      chat.pinnedAt === null &&
      !chat.doneAt,
  )
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(project.name)
  useEffect(() => {
    if (open) {
      setManagingActions(false)
      setRouting(false)
      setDeployments(false)
      setRenaming(false)
      setName(project.name)
    }
  }, [open, project.name])
  const raw = project.id.slice(project.id.indexOf(':') + 1)
  const run = async (fn: () => Promise<unknown>) => {
    if (!writable()) return
    onClose()
    try {
      await fn()
      await store.refresh(project.computerId)
    } catch (error) {
      Alert.alert(
        translate(store.language, 'Could not update project'),
        error instanceof Error ? error.message : String(error),
      )
    }
  }
  const later = (fn: () => void, hostAction = true) => {
    if (hostAction && !writable()) return
    onClose()
    setTimeout(() => {
      if (!hostAction || writable()) fn()
    }, 300)
  }
  const say = (text: string) => translate(store.language, text)
  // Everyday actions first; setup and removal last.
  const items: {
    key: string
    icon: Icon
    label: string
    danger?: boolean
    viewer?: boolean
    /** Work in the project, edit it, set it up, remove it: each group is set apart by a divider. */
    group: 'work' | 'edit' | 'setup' | 'danger'
    onPress(): void
  }[] = [
    {
      key: 'new',
      group: 'work',
      icon: SquarePen,
      label: say('New thread'),
      viewer: true,
      onPress: () => later(() => router.push({ pathname: '/new', params: { project: project.id } }), false),
    },
    {
      key: 'files',
      group: 'work',
      icon: FolderSearch,
      label: say('Browse files'),
      onPress: () =>
        later(() =>
          router.push({ pathname: '/explorer', params: { computer: project.computerId, ctx: `project:${raw}` } }),
        ),
    },
    {
      key: 'terminal',
      group: 'work',
      icon: SquareTerminal,
      label: say('Open terminal'),
      onPress: () =>
        later(() =>
          router.push({ pathname: '/terminal', params: { computer: project.computerId, ctx: `project:${raw}` } }),
        ),
    },
    {
      key: 'deployments',
      group: 'work',
      icon: Rocket,
      label: say('Deployments'),
      onPress: () => {
        if (writable()) setDeployments(true)
      },
    },
    {
      key: 'rename',
      group: 'edit',
      icon: Pencil,
      label: say('Rename'),
      onPress: () => {
        if (writable()) setRenaming(true)
      },
    },
    {
      key: 'copy',
      group: 'edit',
      icon: Copy,
      label: say('Copy folder path'),
      viewer: true,
      onPress: () => {
        onClose()
        if (project.root) void Clipboard.setStringAsync(project.root)
      },
    },
    {
      key: 'routing',
      group: 'setup',
      icon: Sparkles,
      label: say('Names for Auto…'),
      onPress: () => {
        if (writable()) setRouting(true)
      },
    },
    {
      key: 'actions',
      group: 'setup',
      icon: ListChecks,
      label: t.manageProjectActions,
      onPress: () => {
        if (writable()) setManagingActions(true)
      },
    },
    ...(archivable.length
      ? [
          {
            key: 'archive',
            group: 'danger' as const,
            icon: Archive,
            label: say('Archive threads'),
            onPress: () => {
              if (!writable()) return
              onClose()
              void bulk.archive(archivable)
            },
          },
        ]
      : []),
    {
      key: 'remove',
      group: 'danger',
      icon: Trash2,
      label: say('Remove project…'),
      danger: true,
      onPress: () => {
        if (!writable()) return
        onClose()
        Alert.alert(
          say('Remove project?'),
          `${project.name}\n\n${say('Its threads and folders on the host are not deleted.')}`,
          [
            { text: say('Cancel'), style: 'cancel' },
            {
              text: say('Remove'),
              style: 'destructive',
              onPress: () => void run(() => store.invoke(project.computerId, 'projects.remove', raw)),
            },
          ],
        )
      },
    },
  ]
  if (routing)
    return <ProjectRoutingSettings key={`${project.computerId}:${raw}`} project={project} onClose={onClose} />
  if (deployments)
    return (
      <ProjectDeployments
        key={`${project.computerId}:${raw}`}
        hostId={project.computerId}
        projectId={raw}
        projectName={project.name}
        open={open}
        onClose={onClose}
      />
    )
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
    <Sheet open={open} onClose={onClose} title={renaming ? say('Rename project') : project.name}>
      {viewOnly ? <T tone="muted">{VIEW_ONLY_WRITE_NOTICE[store.language]}</T> : null}
      {renaming ? (
        <View style={{ padding: space.l, gap: space.m }}>
          <TextInput
            autoFocus
            editable={!viewOnly}
            value={name}
            onChangeText={setName}
            placeholder={say('Project name')}
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
            <Button kind="ghost" title={say('Cancel')} onPress={() => setRenaming(false)} />
            <Button
              title={say('Save')}
              disabled={viewOnly || !name.trim() || name.trim() === project.name}
              onPress={() => void run(() => store.invoke(project.computerId, 'projects.rename', raw, name.trim()))}
            />
          </View>
        </View>
      ) : (
        runsBy(
          items.filter((item) => !viewOnly || item.viewer),
          (item) => item.group,
        ).map((run) => (
          <SheetGroup key={run[0]!.key}>
            {run.map((item) => (
              <SheetOption
                key={item.key}
                icon={item.icon}
                title={item.label}
                danger={item.danger}
                disabled={!item.onPress}
                onPress={item.onPress}
              />
            ))}
          </SheetGroup>
        ))
      )}
    </Sheet>
  )
}
