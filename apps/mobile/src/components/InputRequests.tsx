import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import type { Chat } from '../runtime/types'
import { pendingRequest } from '../runtime/threadActivity'
import { useStore } from '../runtime/store'
import { useSay } from '../i18n'
import { font, space } from '../theme'
import { Button, ROW_INSET, T } from './ui'
import { ChatRow } from './ChatRow'
import { InlineRequests, TranscriptItemView } from './Transcript'
/** The same request IDs and draft keys back the transcript, activity sheet and Inbox. */
export function InputRequests({ chat }: { chat: Chat }) {
  const store = useStore()
  const say = useSay()
  const router = useRouter()
  const online = store.isOnline(chat.computerId)
  const requests = chat.items.filter(pendingRequest)
  const waiting = !requests.length
  // A thread that is not open keeps only its last messages here, and the question may be older than those or newer than
  // the last read. Read this thread in full now, so the form comes up without opening the thread.
  const latest = useRef(store)
  latest.current = store
  useEffect(() => {
    if (!waiting || !online || !chat.taskId) return
    void latest.current.refresh(chat.computerId, new Set([chat.taskId])).catch(() => {})
  }, [waiting, online, chat.computerId, chat.taskId])
  // The Inbox knows a thread waits before its messages are here; until they are, the thread itself can answer.
  if (waiting)
    return (
      <View style={{ padding: space.m, gap: space.s, alignItems: 'flex-start' }}>
        <T tone="muted">{say('The question is still loading.')}</T>
        <Button
          kind="secondary"
          title={say('Open thread to answer')}
          onPress={() => router.push({ pathname: '/chat/[id]', params: { id: chat.id } })}
        />
      </View>
    )
  return (
    <InlineRequests.Provider value>
      <View style={{ padding: space.m, gap: space.m }}>
        {requests.map((request) => (
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
    </InlineRequests.Provider>
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
