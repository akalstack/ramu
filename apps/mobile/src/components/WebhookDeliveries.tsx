import { useCallback, useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import type { Schedule, WebhookDelivery } from '@ramu/shared/types'
import { font, space } from '../theme'
import { useStore } from '../runtime/store'
import { useSay } from '../i18n'
import { showError } from '../runtime/toast'
import { Divider, SectionLabel, T, tap } from './ui'

const OUTCOME: Record<WebhookDelivery['outcome'], { label: string; tone: 'soft' | 'muted' | 'bad' | 'ok' }> = {
  started: { label: 'Started', tone: 'ok' },
  coalesced: { label: 'Joined a run', tone: 'soft' },
  test: { label: 'Test', tone: 'soft' },
  replayed: { label: 'Replayed', tone: 'soft' },
  filtered: { label: 'Filtered out', tone: 'muted' },
  duplicate: { label: 'Repeat', tone: 'muted' },
  paused: { label: 'Not run', tone: 'muted' },
  'bad-signature': { label: 'Bad signature', tone: 'bad' },
  invalid: { label: 'Invalid', tone: 'bad' },
}

/**
 * What reached a webhook schedule and what came of each request, as the desktop's Requests shows it: one that started
 * no run can be replayed from here. The address and secret stay on the desktop, where full-access devices manage them.
 */
export function WebhookDeliveries({ computer, schedule }: { computer: string; schedule: Schedule }) {
  const store = useStore()
  const say = useSay()
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [busy, setBusy] = useState(false)
  const online = store.isOnline(computer)
  const viewer = store.computers.find((x) => x.id === computer)?.access === 'viewer'
  const load = useCallback(() => {
    void store
      .invoke(computer, 'schedules.deliveries', schedule.id)
      .then(setDeliveries)
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store.invoke is stable; reloads per schedule
  }, [computer, schedule.id])
  useEffect(() => {
    if (online && schedule.webhook) load()
  }, [online, schedule.webhook, load])
  if (!schedule.webhook) return null
  const send = (work: () => Promise<unknown>) => {
    if (busy) return
    tap()
    setBusy(true)
    void work()
      .then(load)
      .catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false))
  }
  return (
    <View>
      <SectionLabel
        right={
          online && !viewer ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              hitSlop={8}
              onPress={() => send(() => store.invoke(computer, 'schedules.sendTest', schedule.id))}
            >
              <T size={font.caption} weight="600" tone={busy ? 'muted' : 'accent'}>
                {say('Send test')}
              </T>
            </Pressable>
          ) : null
        }
      >
        {say('Requests')}
      </SectionLabel>
      {!deliveries.length ? (
        <T tone="muted" style={{ paddingHorizontal: space.l }}>
          {say('Nothing has arrived yet. Send test shows what a run looks like.')}
        </T>
      ) : (
        deliveries.slice(0, 20).map((delivery, index) => (
          <View key={delivery.id}>
            {index ? <Divider inset={space.l} /> : null}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.s,
                paddingHorizontal: space.l,
                paddingVertical: 11,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <T weight="500" tone={OUTCOME[delivery.outcome].tone}>
                  {say(OUTCOME[delivery.outcome].label)}
                </T>
                <T size={font.control} tone="muted" numberOfLines={2}>
                  {[new Date(delivery.receivedAt).toLocaleString(), delivery.summary, delivery.detail]
                    .filter(Boolean)
                    .join(' · ')}
                </T>
              </View>
              {!delivery.runId && online && !viewer ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint={say('Start a run from this request anyway')}
                  disabled={busy}
                  hitSlop={8}
                  onPress={() => send(() => store.invoke(computer, 'schedules.replay', schedule.id, delivery.id))}
                >
                  <T size={font.caption} weight="600" tone={busy ? 'muted' : 'accent'}>
                    {say('Replay')}
                  </T>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))
      )}
    </View>
  )
}
