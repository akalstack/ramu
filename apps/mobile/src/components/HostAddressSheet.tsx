import { useEffect, useRef, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { learnedRoutes } from '@ramu/shared/hostProof'
import type { ReviewAddressResult } from '@ramu/shared/api'
import type { Computer } from '../runtime/types'
import { useStore } from '../runtime/store'
import { useT, fill } from '../i18n'
import { font, radius, space, useTheme } from '../theme'
import { Button, Sheet, T } from './ui'

/** Device-local recovery; the pairing credential and drafts stay bound to the same verified host. */
export function HostAddressSheet({ computer, onClose }: { computer: Computer; onClose: () => void }) {
  const { c } = useTheme()
  const t = useT()
  const { reviewAddress, retry } = useStore()
  const [address, setAddress] = useState(computer.address)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      pending.current?.abort()
    }
  }, [])
  const messages: Partial<Record<ReviewAddressResult, string>> = {
    unreachable: t.nearbyUnreachable,
    mismatch: fill(t.nearbyMismatch, computer.name),
    unsupported: fill(t.nearbyUnsupported, computer.name),
    insecure: fill(t.nearbyInsecure, computer.name),
  }
  const apply = async () => {
    if (pending.current || !address.trim()) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setError(null)
    try {
      const result = await reviewAddress(computer.id, address.trim(), controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      if (result === 'moved' || result === 'unchanged') {
        if (result === 'unchanged' && computer.status !== 'online') retry(computer.id)
        onClose()
      } else setError(messages[result] ?? t.nearbyUnreachable)
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      pending.current = null
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <Sheet
      open
      onClose={() => {
        pending.current?.abort()
        onClose()
      }}
      title={t.hostChangeAddress}
    >
      <View style={{ padding: space.l, gap: space.m }}>
        <T tone="muted" size={font.caption}>
          {t.hostAddressHelp}
        </T>
        {learnedRoutes([computer.address, ...(computer.routes ?? [])]).map((route) => (
          <Pressable
            key={route}
            accessibilityRole="radio"
            accessibilityState={{ selected: address === route, disabled: busy }}
            disabled={busy}
            onPress={() => {
              setAddress(route)
              setError(null)
            }}
            style={{
              minHeight: 44,
              justifyContent: 'center',
              paddingHorizontal: space.s,
              backgroundColor: address === route ? c.fill : undefined,
              borderRadius: radius.s,
            }}
          >
            <T mono size={font.caption} tone={address === route ? 'accent' : 'soft'}>
              {route}
            </T>
          </Pressable>
        ))}
        <T size={font.caption} tone="muted">
          {t.pairAddress}
        </T>
        <TextInput
          value={address}
          editable={!busy}
          accessibilityLabel={t.pairAddress}
          onChangeText={(value) => {
            setAddress(value)
            setError(null)
          }}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={200}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => void apply()}
          style={{
            minHeight: 48,
            color: c.text,
            backgroundColor: c.fill,
            borderRadius: radius.s,
            padding: space.m,
            fontSize: font.body,
          }}
        />
        {error ? (
          <T tone="bad" size={font.caption} accessibilityRole="alert">
            {error}
          </T>
        ) : null}
        <Button
          title={busy ? t.nearbyChecking : fill(t.nearbyUseAddress, computer.name)}
          disabled={busy || !address.trim()}
          onPress={() => void apply()}
        />
      </View>
    </Sheet>
  )
}
