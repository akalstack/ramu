import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Check, ChevronRight, RefreshCw, Square, WifiOff } from 'lucide-react-native'
import { translate } from '@ramu/shared/i18n'
import { elapsedText } from '@ramu/shared/chat/agentActivity'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { font, radius, space, useTheme } from '../theme'
import { Button, Card, Divider, Row, SectionLabel, T, type Icon } from './ui'

/** A row in an activity sheet: the pill's icon in a tinted circle, what it is, one line of detail, and where it leads. */
export function ActivityRow({
  icon: I,
  title,
  detail,
  tone = 'quiet',
  onPress,
}: {
  icon: Icon
  title: string
  detail?: string | null
  tone?: 'quiet' | 'attention' | 'off'
  onPress?(): void
}) {
  const { c } = useTheme()
  const color = tone === 'attention' ? c.warn : tone === 'off' ? c.muted : c.soft
  return (
    <Row onPress={onPress} accessibilityLabel={detail ? `${title}, ${detail}` : title} style={{ gap: space.m }}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: radius.full,
          backgroundColor: c.fill,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <I size={16} color={color} />
      </View>
      <View style={{ flex: 1, gap: 2, paddingVertical: space.s }}>
        <T weight="500">{title}</T>
        {detail ? (
          <T size={font.caption} tone="muted" numberOfLines={2}>
            {detail}
          </T>
        ) : null}
      </View>
      {onPress ? <ChevronRight size={16} color={c.muted} /> : null}
    </Row>
  )
}

/** Rows in one card, divided like the settings lists. */
export function ActivityList({ children }: { children: React.ReactNode[] }) {
  const rows = children.filter(Boolean)
  if (!rows.length) return null
  return (
    <Card style={{ marginHorizontal: space.l }}>
      {rows.map((row, index) => (
        <View key={index}>
          {index ? <Divider inset={62} /> : null}
          {row}
        </View>
      ))}
    </Card>
  )
}

/** The host is unreachable: what that means for the thread, and the one action that helps. */
export function OfflineCard({ chat, onDone }: { chat: Chat; onDone(): void }) {
  const store = useStore()
  const t = (text: string) => translate(store.language, text)
  const host = store.computers.find((computer) => computer.id === chat.computerId)?.name ?? t('This host')
  return (
    <View style={{ gap: space.m }}>
      <ActivityList>
        {[
          <ActivityRow
            key="offline"
            icon={WifiOff}
            tone="off"
            title={host}
            detail={t('Not connected. This is the last activity Ramu saw; the agent keeps working on the host.')}
          />,
        ]}
      </ActivityList>
      <View style={{ paddingHorizontal: space.l }}>
        <Button
          icon={RefreshCw}
          title={t('Reconnect')}
          onPress={() => {
            store.retry(chat.computerId)
            onDone()
          }}
        />
      </View>
    </View>
  )
}

/** What the agent is doing right now: the current action, how long the turn has run, its latest steps, and Stop. */
export function WorkingSheet({ chat, onDone }: { chat: Chat; onDone(): void }) {
  const store = useStore()
  const { c } = useTheme()
  const t = (text: string) => translate(store.language, text)
  const since = chat.turnStartedAt ?? null
  const running = chat.status === 'running'
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!running || !since) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running, since])
  const step = chat.compacting ? { label: 'Compacting context…' } : (chat.step ?? { label: 'Working' })
  const steps = chat.steps ?? []
  return (
    <View style={{ gap: space.s }}>
      <Card style={{ marginHorizontal: space.l, padding: space.l, gap: space.s }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: running ? c.accent : c.muted }} />
          <T weight="600" style={{ flex: 1 }}>
            {running ? t(step.label) : t('Finished')}
          </T>
          {since ? (
            <T size={font.caption} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
              {elapsedText(now - since)}
            </T>
          ) : null}
        </View>
        {running && step.detail ? (
          <T size={font.caption} mono numberOfLines={2} tone="muted">
            {step.detail}
          </T>
        ) : null}
      </Card>
      {steps.length ? (
        <>
          <SectionLabel>{t('This turn')}</SectionLabel>
          <Card style={{ marginHorizontal: space.l }}>
            {steps.map((entry, index) => (
              <View key={index}>
                {index ? <Divider inset={46} /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.m }}>
                  <View style={{ width: 18, alignItems: 'center' }}>
                    {entry.done ? (
                      <Check size={15} color={c.ok} />
                    ) : (
                      <ActivityIndicator size="small" color={c.accent} style={{ transform: [{ scale: 0.75 }] }} />
                    )}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T size={font.control} weight="500">
                      {t(entry.label)}
                    </T>
                    {entry.detail ? (
                      <T size={font.caption} mono tone="muted" numberOfLines={1}>
                        {entry.detail}
                      </T>
                    ) : null}
                  </View>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}
      {running ? (
        <View style={{ paddingHorizontal: space.l, paddingTop: space.s }}>
          <Button
            kind="danger"
            icon={Square}
            title={t('Stop')}
            onPress={() => {
              store.stop(chat.id)
              onDone()
            }}
          />
        </View>
      ) : null}
    </View>
  )
}
