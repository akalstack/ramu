import { useState } from 'react'
import { View } from 'react-native'
import type { Chat } from '../runtime/types'
import { pendingRequest } from '../runtime/threadActivity'
import { useStore } from '../runtime/store'
import { useSay } from '../i18n'
import { font, space } from '../theme'
import { Button, ROW_INSET, T } from './ui'
import { ChatRow } from './ChatRow'
import { TranscriptItemView } from './Transcript'
/** The same request IDs and draft keys back the transcript, activity sheet and Inbox. */
export function InputRequests({ chat }: { chat: Chat }) {
  const store = useStore()
  const say = useSay()
  const online = store.isOnline(chat.computerId)
  return (
    <View style={{ padding: space.m, gap: space.m }}>
      {chat.items.filter(pendingRequest).map((request) => (
        <View key={request.id}>
          <T size={font.caption} tone="muted">
            {request.requestSource?.name ?? say('Main thread')}
          </T>
          {online ? (
            <TranscriptItemView item={request} chat={chat} />
          ) : (
            <T tone="muted">{say('Reconnect to answer this request.')}</T>
          )}
        </View>
      ))}
    </View>
  )
}
export function InboxThread({ chat, project, divider }: { chat: Chat; project?: string; divider?: boolean }) {
  const say = useSay()
  const [open, setOpen] = useState(false)
  const requests = chat.items.filter(pendingRequest)
  return (
    <View>
      <ChatRow chat={chat} project={project} divider={divider} />
      {requests.length ? (
        <View style={{ paddingLeft: ROW_INSET - space.s, paddingRight: space.l, paddingBottom: space.s }}>
          <Button
            kind="ghost"
            title={
              open
                ? say('Hide requests · {0}', { 0: requests.length })
                : say('Answer requests · {0}', { 0: requests.length })
            }
            onPress={() => setOpen((value) => !value)}
          />
          {open ? <InputRequests chat={chat} /> : null}
        </View>
      ) : null}
    </View>
  )
}
