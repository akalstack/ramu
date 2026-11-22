import { useState } from 'react'
import { View } from 'react-native'
import { SquareTerminal } from 'lucide-react-native'
import { terminalAttachmentLabel } from '@ramu/shared/chat/terminalContext'
import { useStore } from '../runtime/store'
import { readTerminalDraft } from '../runtime/terminalChat'
import { font, space, radius, useTheme } from '../theme'
import { useSay } from '../i18n'
import { Button, Chip, Sheet, T, tap } from './ui'

/**
 * Terminal output waiting above a thread's message box, as chips. Tap one to read what goes to the agent or take it
 * off this message; the next send carries the rest.
 */
export function TerminalExcerpts({ draftKey }: { draftKey: string }) {
  const store = useStore()
  const say = useSay()
  const { c } = useTheme()
  const items = readTerminalDraft(store.drafts, draftKey)
  const [openId, setOpenId] = useState<string | null>(null)
  const open = items.find((item) => item.id === openId)
  if (!items.length) return null
  return (
    <>
      {items.map((item) => (
        <Chip
          key={item.id}
          small
          icon={SquareTerminal}
          label={terminalAttachmentLabel(item)}
          maxLabelWidth={200}
          accessibilityHint={say('Shows the output and lets you remove it from this message')}
          onPress={() => {
            tap()
            setOpenId(item.id)
          }}
        />
      ))}
      <Sheet open={!!open} onClose={() => setOpenId(null)} title={open ? terminalAttachmentLabel(open) : undefined}>
        {open ? (
          <View style={{ gap: space.m, paddingHorizontal: space.l }}>
            <View style={{ backgroundColor: c.fill, borderRadius: radius.m, padding: space.m }}>
              <T size={font.caption} style={{ fontFamily: font.mono }} selectable>
                {open.text}
              </T>
            </View>
            <T size={font.caption} tone="muted">
              {say('The agent reads this with your next message.')}
            </T>
            <Button
              kind="secondary"
              title={say('Remove from this message')}
              onPress={() => {
                store.setDraft(draftKey, JSON.stringify(items.filter((item) => item.id !== open.id)))
                setOpenId(null)
              }}
            />
          </View>
        ) : null}
      </Sheet>
    </>
  )
}
