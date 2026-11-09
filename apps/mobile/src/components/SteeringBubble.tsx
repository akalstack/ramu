import { useEffect, useRef, useState } from 'react'
import { TextInput, View } from 'react-native'
import { Pencil, Trash2 } from 'lucide-react-native'
import type { QueuedMessage } from '@ramu/shared/types'
import { replaceVisibleMessage, visibleMessage } from '@ramu/shared/chat/visibleMessage'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { Button, IconButton, T } from './ui'

/**
 * A steer waiting for the running turn, shown after the latest tool call like the desktop. It becomes a sent message
 * once the turn takes it. Editing holds it on the host, so nothing is sent until the edit is saved or cancelled; a saved
 * edit goes out as a new steer.
 */
export function SteeringBubble({
  chatId,
  message,
  readOnly,
}: {
  chatId: string
  message: QueuedMessage
  readOnly: boolean
}) {
  const { c } = useTheme()
  const say = useSay()
  const store = useStore()
  const { holdQueued, editQueued, removeQueued } = store
  const text = visibleMessage(message.text)
  const [draft, setDraft] = useState<string | null>(null)
  const editing = draft !== null
  const release = useRef(() => holdQueued(chatId, message.id, false))
  release.current = () => holdQueued(chatId, message.id, false)
  useEffect(() => {
    if (!editing) return
    // Leaving the chat mid-edit releases the hold, so the steer is not stuck waiting for an editor that is gone.
    return () => release.current()
  }, [editing])
  const startEdit = () => {
    setDraft(text)
    if (!message.held) holdQueued(chatId, message.id, true)
  }
  const save = () => {
    const next = draft?.trim()
    if (!next) return
    setDraft(null)
    if (next !== text) editQueued(chatId, message.id, replaceVisibleMessage(message.text, next))
  }
  return (
    <View style={{ alignSelf: 'flex-end', maxWidth: '86%', alignItems: 'flex-end', gap: 4 }}>
      {editing ? (
        <View style={{ alignSelf: 'stretch', minWidth: 260, gap: space.s }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            autoFocus
            multiline
            accessibilityLabel={say('Edit steering message')}
            style={{
              color: c.text,
              backgroundColor: c.raised2,
              borderRadius: radius.m,
              paddingHorizontal: space.m,
              paddingVertical: space.s + 2,
              fontSize: font.body,
              lineHeight: 21,
              maxHeight: 180,
            }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.s }}>
            <Button kind="ghost" title={say('Cancel')} onPress={() => setDraft(null)} />
            <Button kind="primary" title={say('Save')} disabled={!draft.trim()} onPress={save} />
          </View>
        </View>
      ) : (
        <>
          <View
            accessibilityLabel={`${say('Steer')}: ${text}`}
            style={{
              backgroundColor: c.bubble,
              borderRadius: radius.l - 2,
              borderBottomRightRadius: radius.xs,
              paddingHorizontal: space.m + 2,
              paddingVertical: space.s + 2,
            }}
          >
            <T style={{ lineHeight: 21 }}>{text}</T>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: 2 }}>
            <T size={font.caption} tone="muted">
              {message.held ? say('Held while editing') : say('Steering · sends after the current tool call')}
            </T>
            {readOnly ? null : (
              <>
                <IconButton
                  icon={Pencil}
                  label={say('Edit steering message')}
                  size={28}
                  tone="muted"
                  onPress={startEdit}
                />
                <IconButton
                  icon={Trash2}
                  label={say('Remove steering message')}
                  size={28}
                  tone="muted"
                  onPress={() => removeQueued(chatId, message.id)}
                />
              </>
            )}
          </View>
        </>
      )}
    </View>
  )
}
