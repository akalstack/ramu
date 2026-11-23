import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import type { ChangeElsewhere, ChangeFile } from '@ramu/shared/types'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { font, radius, space, useTheme } from '../theme'
import { Button, T } from './ui'

const groupKey = (group: ChangeElsewhere) => (group.byYou ? 'you' : (group.taskId ?? 'unknown'))

/**
 * What else changed in a shared checkout during the turn, set apart by who wrote it, as on the desktop. Files this
 * thread changed together with someone else are named too, since undo leaves them for the person to settle, and a
 * group nobody else claims joins this thread's changes with one tap.
 */
export function ElsewhereChanges({
  groups,
  shared,
  chat,
  busy,
  onClaim,
}: {
  groups: ChangeElsewhere[]
  shared: ChangeFile[]
  chat: Chat
  busy: boolean
  /** Moves these files into this turn's own changes; absent where the phone may not change the review. */
  onClaim?: (fileIds: string[]) => void
}) {
  const { c } = useTheme()
  const say = useSay()
  const router = useRouter()
  const store = useStore()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const titleOf = (taskId: string) =>
    store.chats.find((other) => other.computerId === chat.computerId && other.taskId === taskId)?.title ??
    say('Another thread')
  const openThread = (taskId: string) =>
    router.push({ pathname: '/chat/[id]', params: { id: store.resolveChat(chat.computerId, taskId) } })
  const label = (group: ChangeElsewhere) =>
    group.byYou
      ? say('Changed by you · {0} files', { 0: group.files.length })
      : group.taskId
        ? say('Changed by “{0}” · {1} files', { 0: titleOf(group.taskId), 1: group.files.length })
        : say('Changed outside this thread · {0} files', { 0: group.files.length })
  const theirs = shared.filter((file) => file.sharedWith?.length)
  const yours = shared.filter((file) => !file.sharedWith?.length && file.editedByYou)
  return (
    <View style={{ gap: space.s, paddingTop: space.s }}>
      {theirs.length ? (
        <T size={font.caption} tone="muted">
          {say('Also changed by another thread, so not undone with this turn: {0}', {
            0: theirs.map((file) => file.path).join(', '),
          })}
        </T>
      ) : null}
      {yours.length ? (
        <T size={font.caption} tone="muted">
          {say('Also edited by you, so not undone with this turn: {0}', {
            0: yours.map((file) => file.path).join(', '),
          })}
        </T>
      ) : null}
      {groups.map((group) => {
        const key = groupKey(group)
        const expanded = !!open[key]
        const Chevron = expanded ? ChevronDown : ChevronRight
        return (
          <View key={key} style={{ borderRadius: radius.m, backgroundColor: c.fill, padding: space.s, gap: space.xs }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setOpen((state) => ({ ...state, [key]: !expanded }))}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 32 }}
            >
              <Chevron size={14} color={c.muted} />
              <T size={font.control} tone="muted" style={{ flex: 1 }}>
                {label(group)}
              </T>
              {group.taskId ? (
                <Button kind="ghost" title={say('Open thread')} onPress={() => openThread(group.taskId!)} />
              ) : null}
            </Pressable>
            {expanded
              ? group.files.map((file) => (
                  <T key={file.id} size={font.caption} mono numberOfLines={1} style={{ paddingLeft: space.l }}>
                    {file.path}
                  </T>
                ))
              : null}
            {onClaim && !group.taskId ? (
              <Button
                kind="secondary"
                title={say('Add to this thread’s changes')}
                disabled={busy}
                onPress={() => onClaim(group.files.map((file) => file.id))}
              />
            ) : null}
          </View>
        )
      })}
    </View>
  )
}
