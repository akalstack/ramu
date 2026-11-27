import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { Check, Lightbulb } from 'lucide-react-native'
import { reasonCopy, type ToolSuggestionView } from '@ramu/shared/toolSuggestions'
import { font, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { Button, Card, T } from './ui'
import { ADMINISTER_REFUSAL } from '@ramu/shared/devicePermissions'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
/** Channels after which the card may read differently: its own change, or a tool turned on on the host. */
const CHANGES = new Set(['workspace:changed', 'plugins:changed', 'mcp:changed'])

/**
 * A tool Ramu suggests from what this thread did, as on the desktop: what it does and why. Turning it on stays on the
 * computer running the host, as installing does in Customize; Not now hides it for the project from here too.
 */
export function ToolSuggestionCard({ computerId, cardId }: { computerId: string; cardId: string }) {
  const say = useSay()
  const store = useStore()
  const { c } = useTheme()
  const [view, setView] = useState<ToolSuggestionView | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const read = useCallback(
    () =>
      store
        .invoke(computerId, 'toolSuggestions.get', cardId)
        .then(setView)
        .catch(() => setView(null)),
    [store, computerId, cardId],
  )
  const readRef = useRef(read)
  readRef.current = read
  useEffect(() => {
    void read()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = store.subscribe(computerId, (...[channel]) => {
      if (!CHANGES.has(channel)) return
      clearTimeout(timer)
      timer = setTimeout(() => void readRef.current(), 400)
    })
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [read, store, computerId])

  if (!view) return null
  const { card, status, canTurnOn, canAnswer } = view
  const dismiss = async () => {
    setBusy(true)
    setError(null)
    try {
      setView(await store.invoke(computerId, 'toolSuggestions.dismiss', card.id))
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  const reason = reasonCopy(card.reason)
  const settled = status.state === 'on' || status.state === 'dismissed'
  return (
    <Card style={{ marginVertical: space.s, padding: space.m, gap: space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Lightbulb size={16} color={c.text} />
        <T weight="600" numberOfLines={1} style={{ flex: 1 }}>
          {card.title}
        </T>
        {status.state === 'on' ? <Check size={13} color={c.ok} /> : null}
        <T size={font.caption} tone={status.state === 'on' ? 'ok' : 'muted'}>
          {status.state === 'on'
            ? say('On')
            : status.state === 'dismissed'
              ? say('Hidden for this project')
              : say('Suggested tool')}
        </T>
      </View>
      {card.description ? <T>{card.description}</T> : null}
      <T size={font.caption} tone="muted">
        {say(reason.text, reason.values)}
      </T>
      {error ? (
        <T size={font.caption} tone="bad" accessibilityRole="alert">
          {error}
        </T>
      ) : null}
      {canAnswer && !settled && !canTurnOn ? (
        <T size={font.caption} tone="muted">
          {say(ADMINISTER_REFUSAL)}
        </T>
      ) : null}
      {canAnswer && status.state === 'open' ? (
        <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
          <Button title={say('Not now')} kind="ghost" disabled={busy} onPress={() => void dismiss()} />
        </View>
      ) : null}
    </Card>
  )
}
