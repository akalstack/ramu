import { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { Clock, GitFork } from 'lucide-react-native'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { font, space, useTheme } from '../theme'
import { Button, T } from './ui'

/**
 * Another thread edited the same file in this checkout during this turn, as on the desktop: both keep working, each
 * keeps only what it wrote, and moving this thread to its own worktree ends the overlap.
 */
export function CheckoutClashCard({ path, taskId, chat }: { path: string; taskId: string; chat: Chat }) {
  const { c } = useTheme()
  const say = useSay()
  const router = useRouter()
  const store = useStore()
  const [error, setError] = useState('')
  const [moving, setMoving] = useState(false)
  const title =
    store.chats.find((other) => other.computerId === chat.computerId && other.taskId === taskId)?.title ??
    say('Another thread')
  const file = path.split(/[\\/]/).at(-1) ?? path
  const canMove = !!chat.sessionId && store.computers.find((pc) => pc.id === chat.computerId)?.access !== 'viewer'
  const move = async () => {
    setError('')
    setMoving(true)
    try {
      const started = await store.invoke(chat.computerId, 'threads.continueInWorktree', chat.sessionId!)
      router.push({ pathname: '/chat/[id]', params: { id: store.resolveChat(chat.computerId, started.taskId) } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setMoving(false)
    }
  }
  return (
    <View style={{ gap: space.xs, paddingVertical: space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <GitFork size={14} color={c.muted} />
        <T size={font.caption} tone="muted" style={{ flex: 1 }}>
          {say('“{0}” is also editing {1} in this checkout. Each thread keeps only its own changes.', {
            0: title,
            1: file,
          })}
        </T>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        <Button
          kind="ghost"
          title={say('Open thread')}
          onPress={() =>
            router.push({ pathname: '/chat/[id]', params: { id: store.resolveChat(chat.computerId, taskId) } })
          }
        />
        {canMove ? (
          <Button kind="ghost" title={say('Move to a new worktree')} disabled={moving} onPress={() => void move()} />
        ) : null}
      </View>
      {error ? (
        <T size={font.caption} tone="bad">
          {error}
        </T>
      ) : null}
    </View>
  )
}

/** A command held until another thread's command in this checkout finished, so each one's writes stay its own. */
export function CommandWaitNote({ taskId, chat }: { taskId: string; chat: Chat }) {
  const { c } = useTheme()
  const say = useSay()
  const store = useStore()
  const title =
    store.chats.find((other) => other.computerId === chat.computerId && other.taskId === taskId)?.title ??
    say('Another thread')
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.xs }}>
      <Clock size={14} color={c.muted} />
      <T size={font.caption} tone="muted" style={{ flex: 1 }}>
        {say('Held a command until “{0}” finished its own, so each thread’s changes stay apart.', { 0: title })}
      </T>
    </View>
  )
}
