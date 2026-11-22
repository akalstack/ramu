import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { ArrowRight, Gauge } from 'lucide-react-native'
import type { NextMessageRoute } from '@ramu/shared/types'
import { providerName } from '@ramu/shared/providers/providers'
import { useStore } from '../runtime/store'
import { routeChip, type RouteChip } from '../runtime/providerRoute'
import type { Chat } from '../runtime/types'
import { font, space } from '../theme'
import { useSay } from '../i18n'
import { Chip, Sheet, T, tap } from './ui'
import { SheetGroup, SheetOption } from './SheetOptions'

/** How often the composer asks again while the thread is open; usage moves slowly. */
const REFRESH_MS = 60_000

/** The host's answer for where the next message goes, asked again when the model changes and every minute. */
export function useNextRoute(chat: Chat | undefined): { chip: RouteChip; reload: () => void } {
  const store = useStore()
  const computerId = chat?.computerId ?? ''
  const sessionId = chat?.sessionId ?? null
  const online = !!chat && store.isOnline(computerId)
  const [route, setRoute] = useState<NextMessageRoute | null>(null)
  const provider = chat?.provider
  const model = chat?.model
  const reload = useCallback(() => {
    if (!sessionId || !online) return setRoute(null)
    void store.invoke(computerId, 'agent.nextRoute', sessionId).then(setRoute, () => setRoute(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `store` changes identity on every update; the call reads it fresh
  }, [computerId, sessionId, online])
  useEffect(() => {
    reload()
    const timer = setInterval(reload, REFRESH_MS)
    return () => clearInterval(timer)
  }, [reload, provider, model])
  return { chip: routeChip(route), reload }
}

/**
 * Above the message box when the next message would switch to the fallback, as on the desktop: tap to keep the
 * current provider for this message or this thread, or to use the fallback again.
 */
export function ProviderRouteChip({ chat, chip, onChange }: { chat: Chat; chip: RouteChip; onChange: () => void }) {
  const store = useStore()
  const say = useSay()
  const [open, setOpen] = useState(false)
  if (!chip || !chat.sessionId) return null
  const current = providerName(chat.provider)
  const viewer = store.computers.find((computer) => computer.id === chat.computerId)?.access === 'viewer'
  const keep = (scope: 'message' | 'chat' | null) => {
    setOpen(false)
    void store
      .invoke(chat.computerId, 'agent.holdProvider', chat.sessionId!, scope)
      .then(onChange)
      .catch(() => {})
  }
  return (
    <>
      <Chip
        small
        icon={chip.kind === 'switch' ? ArrowRight : Gauge}
        label={
          chip.kind === 'switch' ? `${providerName(chip.to)} · ${chip.reason}` : say('Keeping {0}', { 0: current })
        }
        maxLabelWidth={240}
        accessibilityLabel={
          chip.kind === 'switch'
            ? say('Sending with {0}: {1}', { 0: providerName(chip.to), 1: chip.reason })
            : say('Keeping {0}', { 0: current })
        }
        onPress={() => {
          tap()
          setOpen(true)
        }}
      />
      <Sheet open={open} onClose={() => setOpen(false)} title={say('Next message')}>
        <View style={{ paddingHorizontal: space.l, paddingBottom: space.s }}>
          <T size={font.control} tone="muted">
            {chip.kind === 'switch'
              ? say('Next message goes to {0} with the conversation handed over', { 0: providerName(chip.to) })
              : say('Keeping {0}', { 0: current })}
          </T>
        </View>
        <SheetGroup>
          {chip.kind === 'switch' ? (
            <>
              <SheetOption
                title={say('Keep {0} for this message', { 0: current })}
                disabled={viewer}
                onPress={() => keep('message')}
              />
              <SheetOption
                title={say('Keep {0} for this thread', { 0: current })}
                help={say('Until its limit resets')}
                disabled={viewer}
                onPress={() => keep('chat')}
              />
            </>
          ) : (
            <SheetOption
              title={say('Use the fallback ({0}) again', { 0: providerName(chip.fallback) })}
              disabled={viewer}
              onPress={() => keep(null)}
            />
          )}
        </SheetGroup>
      </Sheet>
    </>
  )
}
