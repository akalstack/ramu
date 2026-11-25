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
  const wait = chat ? limitWaitOf(chat.items, chat.doneAt) : null
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
  const prefs = store.appPreferences[chat.computerId]
  const offline = !store.isOnline(chat.computerId)
  return (
    <View
      accessibilityRole="summary"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s,
        paddingHorizontal: space.m,
        paddingVertical: space.s,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.lineStrong,
      }}
    >
      <Clock3 size={15} color={c.warn} strokeWidth={1.9} />
      {/* What happened, when it continues, and this thread's own Auto-resume choice, stacked so none of it wraps oddly. */}
      <View style={{ flex: 1, gap: 1 }}>
        <T
          size={font.control}
          weight="600"
          numberOfLines={1}
          tone={model.title === 'limitHasReset' ? undefined : 'warn'}
        >
          {t[model.title]}
        </T>
        <T size={font.caption} tone="muted" numberOfLines={2}>
          {detail.charAt(0).toUpperCase() + detail.slice(1)}
        </T>
        {prefs ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={state}
            onPress={() => {
              tap()
              setOpen(true)
            }}
            hitSlop={6}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingTop: 2 }}
          >
            <T size={font.caption} tone="soft">
              {state}
            </T>
            <ChevronDown size={12} color={c.muted} />
          </Pressable>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={button}
        disabled={trying || offline}
        hitSlop={8}
        onPress={tryNow}
        style={({ pressed }) => ({
          height: 30,
          paddingHorizontal: space.m,
          justifyContent: 'center',
          borderRadius: radius.full,
          backgroundColor: model.primary ? c.primary : pressed ? c.pressed : c.fill,
          opacity: trying || offline ? 0.5 : 1,
        })}
      >
        <T size={font.caption} weight="600" style={{ color: model.primary ? c.primaryInk : c.text }}>
          {button}
        </T>
      </Pressable>
      {prefs ? (
        <Sheet open={open} onClose={() => setOpen(false)} title={t.autoResume}>
          <AutoResumeRows chatId={chat.id} onPicked={() => setOpen(false)} />
        </Sheet>
      ) : null}
    </View>
  )
}
