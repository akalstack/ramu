import { translate } from '@ramu/shared/i18n'
import { confirmDone } from './confirmDone'
import { readRemovalCommands } from '@ramu/shared/chat/taskRemoval'
import { useRef } from 'react'
import { Alert } from 'react-native'
import { useStore } from '../runtime/store'
import { showError, showToast } from '../runtime/toast'
import { donePlan, threadSelection } from '../runtime/threadSelection'
import type { Chat } from '../runtime/types'

type Store = ReturnType<typeof useStore>

/** Runs one host call per thread, then refreshes each host once; the first failure stops the rest and is shown. */
async function each(store: Store, chats: readonly Chat[], call: (chat: Chat) => Promise<unknown>): Promise<Chat[]> {
  const changed: Chat[] = []
  try {
    for (const chat of chats) {
      await call(chat)
      changed.push(chat)
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error))
  }
  await Promise.all([...new Set(chats.map((chat) => chat.computerId))].map((host) => store.refresh(host)))
  return changed
}

/**
 * Mark done, archive and delete for the threads picked on the Threads tab. Done and archive can be undone from the
 * toast; delete asks once, and keeps any thread with a background command for its own review so nothing running is lost.
 */
export function useBulkThreadActions() {
  const store = useStore()
  const latest = useRef(store)
  latest.current = store
  const say = (text: string, values?: Record<string, string | number>) => translate(store.language, text, values)
  const writable = (chat: Chat) =>
    latest.current.isOnline(chat.computerId) &&
    latest.current.computers.find((host) => host.id === chat.computerId)?.access !== 'viewer'
  const undo = (message: string, chats: Chat[], method: 'tasks.done' | 'tasks.archive') =>
    showToast(message, {
      label: 'undo',
      run: () =>
        void each(latest.current, chats, (chat) => latest.current.invoke(chat.computerId, method, chat.taskId, false)),
    })
  return {
    /** Whether the picked threads can be changed from here: every host online and not view-only. */
    writable: (chats: readonly Chat[]) => chats.length > 0 && chats.every(writable),
    async markDone(chats: readonly Chat[]) {
      const { done, targets } = donePlan(chats.filter(writable))
      if (done && !(await confirmDone(latest.current.invoke, say, targets))) return
      threadSelection.clear()
      const changed = await each(latest.current, targets, (chat) =>
        latest.current.invoke(chat.computerId, 'tasks.done', chat.taskId, done),
      )
      if (done && changed.length) undo(say('{0} marked done', { 0: changed.length }), changed, 'tasks.done')
    },
    async archive(chats: readonly Chat[]) {
      const targets = chats.filter((chat) => writable(chat) && chat.status !== 'archived')
      threadSelection.clear()
      const changed = await each(latest.current, targets, (chat) =>
        latest.current.invoke(chat.computerId, 'tasks.archive', chat.taskId, true),
      )
      if (changed.length) undo(say('{0} archived', { 0: changed.length }), changed, 'tasks.archive')
    },
    async remove(chats: readonly Chat[]) {
      const targets = chats.filter(writable)
      if (!targets.length) return
      let plain: Chat[]
      try {
        const commands = await Promise.all(
          targets.map((chat) =>
            readRemovalCommands(
              (method, taskId) => latest.current.invoke(chat.computerId, method, taskId),
              chat.taskId,
            ),
          ),
        )
        plain = targets.filter((_, index) => !commands[index]!.length)
      } catch (error) {
        Alert.alert(say('Could not update thread'), error instanceof Error ? error.message : String(error))
        return
      }
      const kept = targets.length - plain.length
      const message = [
        say('This removes the threads from their hosts. Files in their checkouts and worktrees stay.'),
        ...(kept
          ? [
              say('{0} with background commands are kept. Delete those one at a time to review their commands.', {
                0: kept,
              }),
            ]
          : []),
      ].join('\n\n')
      if (!plain.length) {
        Alert.alert(say('Nothing to delete here'), message)
        return
      }
      Alert.alert(say('Delete {0} threads?', { 0: plain.length }), message, [
        { text: say('Cancel'), style: 'cancel' },
        {
          text: say('Delete'),
          style: 'destructive',
          onPress: () => {
            threadSelection.clear()
            void each(latest.current, plain, (chat) =>
              latest.current.invoke(chat.computerId, 'tasks.delete', chat.taskId, false).catch((error: unknown) => {
                throw new Error(say(error instanceof Error ? error.message : String(error)))
              }),
            )
          },
        },
      ])
    },
  }
}
