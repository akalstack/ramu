import { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { Clock, GitBranch, Pin } from 'lucide-react-native'
import { font, useTheme } from '../theme'
import type { Chat } from '../runtime/types'
import { ago } from '../i18n'
import { Row, StatusIcon, T, tap } from './ui'
import { ChatActionsSheet } from './ChatActions'

export function ChatRow({ chat, project }: { chat: Chat; project?: string }) {
  const { c } = useTheme()
  const router = useRouter()
  const [menu, setMenu] = useState(false)
  return (
    <>
    <Row onLongPress={chat.pending ? undefined : () => { tap(); setMenu(true) }} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: chat.id } })} style={{ alignItems: 'flex-start', paddingVertical: 10 }} accessibilityLabel={chat.title}>
      <View style={{ paddingTop: 2 }}>
        {chat.pending ? <Clock size={16} color={c.muted} /> : <StatusIcon status={chat.status} />}
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
          <T size={font.control} tone={chat.status === 'needs-input' ? 'warn' : chat.status === 'failed' ? 'bad' : 'muted'} numberOfLines={1} style={{ flex: 1 }}>
            {chat.preview}
          </T>
        </View>
      </View>
    </Row>
    {chat.pending ? null : <ChatActionsSheet chat={chat} open={menu} onClose={() => setMenu(false)} />}
    </>
  )
}
