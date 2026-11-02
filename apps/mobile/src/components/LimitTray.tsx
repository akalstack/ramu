import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { ChevronDown, Clock3 } from 'lucide-react-native'
import { autoResumeOverride } from '@ramu/shared/chat/limitPolicy'
import { font, radius, space, useTheme } from '../theme'
import { fill, useT } from '../i18n'
import { useStore } from '../runtime/store'
import { autoResumeMenu, limitTrayModel, limitWaitOf } from '../runtime/limitTray'
import { Sheet, T, tap } from './ui'
import { SheetGroup, SheetOption } from './SheetOptions'

const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** The thread's own Auto-resume choice as three rows: Use default (on/off), On, Off. Used by the tray and the agent settings sheet. */
export function AutoResumeRows({ chatId, onPicked }: { chatId: string; onPicked?: () => void }) {
  const store = useStore()
  const t = useT()
  const chat = store.chats.find((entry) => entry.id === chatId)
  if (!chat) return null
  const items = autoResumeMenu(chat.settings, store.appPreferences[chat.computerId]?.fallback)
  return (
    <SheetGroup title={t.autoResume} footer={t.autoResumeHint}>
      {items.map((item) => (
        <SheetOption
          key={item.choice}
          title={t.autoResumeText[item.label] ?? item.label}
          selected={item.selected}
          disabled={!store.isOnline(chat.computerId)}
          onPress={() => {
            if (!item.selected) store.setAutoResume(chat.id, autoResumeOverride(item.choice))
            onPicked?.()
          }}
        />
      ))}
    </SheetGroup>
  )
}

/**
 * One row above the composer while a thread is held at a usage limit: the cause, when it continues, a Try again /
 * Try anyway / Resume button, and this thread's Auto-resume control. The thread is never failed.
 */
export function LimitTray({ chatId }: { chatId: string }) {
  const store = useStore()
  const t = useT()
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const [trying, setTrying] = useState(false)
  const [still, setStill] = useState(false)
  const chat = store.chats.find((entry) => entry.id === chatId)
  const wait = chat ? limitWaitOf(chat.items) : null
  // A new wait (a new reset time) starts clean; "Still limited" belongs to the try that just failed.
  useEffect(() => setStill(false), [wait?.retryAt])
  if (!chat || !wait) return null
  const model = limitTrayModel(wait, chat.settings, store.appPreferences[chat.computerId]?.fallback, {
    stillLimited: still,
  })
  const time = model.resetAt !== undefined ? timeOf(model.resetAt) : ''
  const detail = fill(t[model.detail], time)
  const button = model.action === 'resume' ? t.resume : model.action === 'try-again' ? t.tryAgain : t.tryAnyway
  const state = fill(t.autoResumeState, t.autoResumeText[model.autoResumeLabel] ?? model.autoResumeLabel)
  const tryNow = () => {
    if (trying || !store.isOnline(chat.computerId)) return
    tap()
    setTrying(true)
    void store.retryLimitNow(chat.id).then((result) => {
      setTrying(false)
      // Only a try that was answered and did not get through is "Still limited"; a failure is reported by the store.
      if (result && !result.resumed) setStill(true)
    })
  }
  return (
    <View
      style={{
        paddingHorizontal: space.m,
        paddingVertical: 4,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.lineStrong,
        gap: 2,
      }}
    >
      <View
        accessibilityRole="summary"
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 32 }}
      >
        <Clock3 size={14} color={c.muted} strokeWidth={1.8} />
        <T size={font.control} numberOfLines={2} style={{ flex: 1 }}>
          <T size={font.control} weight="600">
            {t[model.title]}
          </T>
          <T size={font.control} tone="muted">{` · ${detail}`}</T>
        </T>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={button}
          disabled={trying || !store.isOnline(chat.computerId)}
          hitSlop={6}
          onPress={tryNow}
          style={{
            height: 28,
            paddingHorizontal: space.m,
            justifyContent: 'center',
            borderRadius: radius.full,
            backgroundColor: model.primary ? c.primary : c.fill,
            opacity: trying || !store.isOnline(chat.computerId) ? 0.5 : 1,
          }}
        >
          <T size={font.caption} weight="600" style={{ color: model.primary ? c.primaryInk : c.soft }}>
            {button}
          </T>
        </Pressable>
      </View>
      {store.appPreferences[chat.computerId] ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={state}
            onPress={() => {
              tap()
              setOpen(true)
            }}
            hitSlop={6}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', height: 26 }}
          >
            <T size={font.caption} tone="muted">
              {state}
            </T>
            <ChevronDown size={12} color={c.muted} />
          </Pressable>
          <Sheet open={open} onClose={() => setOpen(false)} title={t.autoResume}>
            <AutoResumeRows chatId={chat.id} onPicked={() => setOpen(false)} />
          </Sheet>
        </>
      ) : null}
    </View>
  )
}
