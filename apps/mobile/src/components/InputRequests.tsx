import { useState } from 'react'
import { View } from 'react-native'
import type { Chat } from '../runtime/types'
import { inboxBlocker } from '@ramu/shared/hostInbox'
import { inboxBlockerText } from '../runtime/inboxBlockerText'
import { pendingRequest } from '../runtime/threadActivity'
import { useStore } from '../runtime/store'
import { font, space } from '../theme'
import { Button, ROW_INSET, T } from './ui'
import { ChatRow } from './ChatRow'
import { TranscriptItemView } from './Transcript'
/** The same request IDs and draft keys back the transcript, activity sheet and Inbox. */
export function InputRequests({ chat }: { chat: Chat }) {
  const store = useStore()
  const online = store.isOnline(chat.computerId)
  const id = store.language === 'id'
  return (
    <View style={{ padding: space.m, gap: space.m }}>
      {chat.items.filter(pendingRequest).map((request) => (
        <View key={request.id}>
          <T size={font.caption} tone="muted">
            {request.requestSource?.name ?? (id ? 'Thread utama' : 'Main thread')}
          </T>
          {online ? (
            <TranscriptItemView item={request} chat={chat} />
          ) : (
            <T tone="muted">
              {id ? 'Hubungkan kembali untuk menjawab permintaan ini.' : 'Reconnect to answer this request.'}
            </T>
          )}
        </View>
      ))}
    </View>
  )
}
export function InboxThread({ chat, project, divider }: { chat: Chat; project?: string; divider?: boolean }) {
  const { language } = useStore()
  const [open, setOpen] = useState(false)
  const requests = chat.items.filter(pendingRequest)
  const blocker = inboxBlocker(chat)
  return (
    <View>
      <ChatRow chat={chat} project={project} divider={divider} />
      {blocker ? (
        <T
          size={font.caption}
          tone="muted"
          style={{ paddingLeft: ROW_INSET, paddingRight: space.l, paddingBottom: space.xs }}
        >
          {inboxBlockerText(blocker, language === 'id' ? 'id' : 'en')}
        </T>
      ) : null}
      {requests.length ? (
        <View style={{ paddingLeft: ROW_INSET - space.s, paddingRight: space.l, paddingBottom: space.s }}>
          <Button
            kind="ghost"
            title={
              language === 'id'
                ? `${open ? 'Sembunyikan' : 'Jawab'} permintaan · ${requests.length}`
                : `${open ? 'Hide' : 'Answer'} requests · ${requests.length}`
            }
            onPress={() => setOpen((value) => !value)}
          />
          {open ? <InputRequests chat={chat} /> : null}
        </View>
      ) : null}
    </View>
  )
}
