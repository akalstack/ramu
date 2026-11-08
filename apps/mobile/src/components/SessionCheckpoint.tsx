import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { checkpointMarkdown } from '@ramu/shared/chat/checkpointMarkdown'
import type { SessionCheckpoint } from '@ramu/shared/types'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { font, space } from '../theme'
import { Markdown } from './Markdown'
import { Button, Sheet, T } from './ui'

/**
 * The thread's saved progress summary, or null while it has none. The phone does not stream memory changes, so it reads
 * again when the thread reconnects or a turn starts or ends (`turn`), which is when the host saves a newer one.
 */
export function useSessionCheckpoint(
  computerId: string,
  sessionId: string | null,
  online: boolean,
  turn: number | null,
): SessionCheckpoint | null {
  const store = useStore()
  const latest = useRef(store)
  latest.current = store
  const generation = useRef(0)
  const [checkpoint, setCheckpoint] = useState<{ key: string; value: SessionCheckpoint | null } | null>(null)
  const key = JSON.stringify([computerId, sessionId])
  useEffect(() => {
    // Each read is a new generation, so a slower earlier answer never replaces the newest one.
    const mine = ++generation.current
    if (!sessionId || !online) return
    void latest.current.invoke(computerId, 'agent.checkpoint', sessionId).then(
      (value) => mine === generation.current && setCheckpoint({ key, value }),
      // A failed read keeps what was shown; the next reconnect or turn reads again.
      () => {},
    )
  }, [computerId, sessionId, online, turn, key])
  return sessionId && checkpoint?.key === key ? checkpoint.value : null
}

/** Reads the saved summary on the phone: what the agent would carry on from, and Copy to reuse it in another thread. */
export function SessionCheckpointSheet({
  checkpoint,
  open,
  onClose,
}: {
  checkpoint: SessionCheckpoint | null
  open: boolean
  onClose: () => void
}) {
  const say = useSay()
  const store = useStore()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!open) setCopied(false)
  }, [open])
  const saved = checkpoint
    ? new Date(checkpoint.updatedAt).toLocaleString(store.language === 'id' ? 'id-ID' : undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : ''
  return (
    <Sheet open={open && !!checkpoint} onClose={onClose} title={say('Session checkpoint')}>
      {checkpoint ? (
        <View style={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
          <T size={font.caption} tone="muted">
            {`${say('Saved {0}', { 0: saved })} · ${say('This thread only. Newer messages and the current files win over this summary.')}`}
          </T>
          <Markdown text={checkpointMarkdown(checkpoint.summary)} />
          <T size={font.caption} tone="muted">
            {say('Copy to reuse it in another thread')}
          </T>
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Button
              kind="secondary"
              title={copied ? say('Copied') : say('Copy')}
              style={{ flex: 1 }}
              onPress={() =>
                void Clipboard.setStringAsync(checkpoint.summary).then(
                  () => setCopied(true),
                  () => setCopied(false),
                )
              }
            />
            <Button title={say('Done')} style={{ flex: 1 }} onPress={onClose} />
          </View>
        </View>
      ) : null}
    </Sheet>
  )
}
