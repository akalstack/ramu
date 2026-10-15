import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Archive, ArchiveRestore, Clock, GitBranch, Pin, PinOff } from 'lucide-react-native'
import { font, useTheme } from '../theme'
import type { Chat } from '../runtime/types'
import { ago } from '../i18n'
import { Row, StatusIcon, T, tap } from './ui'
import { ChatActionsSheet, useChatCommands } from './ChatActions'
import { SwipeRow } from './SwipeRow'
import { useStore } from '../runtime/store'

/** A chat inside a rounded card; `divider` draws the hairline between stacked rows. */
export function ChatRow({ chat, project, divider }: { chat: Chat; project?: string; divider?: boolean }) {
  const { c } = useTheme()
  const router = useRouter()
  const [menu, setMenu] = useState(false)
  const commands = useChatCommands(chat)
  const store = useStore()
  // Unread, shared with the desktop: the computer keeps a "finished" notice until the chat is opened on any device.
  const unread =
    Boolean(chat.sessionId) &&
    (store.inbox[chat.computerId] ?? []).some((n) => n.sessionId === chat.sessionId && n.kind === 'done')
  const actions = chat.pending
    ? []
    : [
        {
          icon: commands.pinned ? PinOff : Pin,
          label: commands.pinned ? 'Unpin' : 'Pin',
          color: c.primary,
          onPress: () => void commands.togglePin(),
        },
        {
          icon: commands.archived ? ArchiveRestore : Archive,
          label: commands.archived ? 'Unarchive' : 'Archive',
          color: c.warn,
          onPress: () => void commands.toggleArchive(),
        },
      ]
  return (
    <>
      <SwipeRow actions={actions} background={c.raised2}>
        <Row
          onLongPress={
            chat.pending
              ? undefined
              : () => {
                  tap()
                  setMenu(true)
                }
          }
          onPress={() => router.push({ pathname: '/chat/[id]', params: { id: chat.id } })}
          style={{
            alignItems: 'flex-start',
            paddingVertical: 10,
            borderTopWidth: divider ? StyleSheet.hairlineWidth : 0,
            borderTopColor: c.lineStrong,
          }}
          accessibilityLabel={chat.title}
        >
          <View style={{ paddingTop: 2 }}>
            {chat.pending ? (
              <Clock size={16} color={c.muted} />
            ) : unread && (chat.status === 'idle' || chat.status === 'ready-for-review') ? (
              <View
                accessibilityLabel="Unread"
                style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}
              >
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent }} />
              </View>
            ) : (
              <StatusIcon status={chat.status} />
            )}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <T size={font.body} weight="500" numberOfLines={1} style={{ flex: 1 }}>
                {chat.title}
              </T>
              {chat.pinnedAt !== null ? <Pin size={11} color={c.muted} /> : null}
              <T size={font.caption} tone="muted">
                {ago(chat.lastActiveAt)}
              </T>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {project ? (
                <T size={font.control} tone="soft" numberOfLines={1}>
                  {project}
                </T>
              ) : null}
              {chat.mode === 'worktree' ? <GitBranch size={12} color={c.muted} /> : null}
              <T
                size={font.control}
                tone={chat.status === 'needs-input' ? 'warn' : chat.status === 'failed' ? 'bad' : 'muted'}
                numberOfLines={1}
                style={{ flex: 1 }}
              >
                {chat.preview}
              </T>
            </View>
          </View>
        </Row>
      </SwipeRow>
      {chat.pending ? null : <ChatActionsSheet chat={chat} open={menu} onClose={() => setMenu(false)} />}
    </>
  )
}
