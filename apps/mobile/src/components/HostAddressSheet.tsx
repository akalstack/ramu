import { useEffect, useRef, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Check } from 'lucide-react-native'
import { learnedRoutes } from '@ramu/shared/hostProof'
import { hostOfUrl, networkName } from '@ramu/shared/networkLabel'
import type { ReviewAddressResult } from '@ramu/shared/api'
import type { Computer } from '../runtime/types'
import { useStore } from '../runtime/store'
import { useSay, useT, fill } from '../i18n'
import { font, radius, space, useTheme } from '../theme'
import { Button, Sheet, T } from './ui'

/** Device-local recovery; the pairing credential and drafts stay bound to the same verified host. */
export function HostAddressSheet({ computer, onClose }: { computer: Computer; onClose: () => void }) {
  const { c } = useTheme()
  const t = useT()
  const say = useSay()
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
  const apply = async (target = address) => {
    if (pending.current || !target.trim()) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setError(null)
    try {
      const result = await reviewAddress(computer.id, target.trim(), controller.signal)
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
      title={say('Switch network')}
    >
      <View style={{ padding: space.l, gap: space.m }}>
        <T tone="muted" size={font.caption}>
          {say('Both devices must be on the network you pick. Ramu checks it is the same host before switching.')}
        </T>
        {learnedRoutes([computer.address, ...(computer.routes ?? [])]).map((route) => (
          <Pressable
            key={route}
            accessibilityRole="radio"
            accessibilityState={{ selected: computer.address === route, disabled: busy }}
            disabled={busy}
            onPress={() => {
              setAddress(route)
              setError(null)
              void apply(route)
            }}
            style={{
              minHeight: 52,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s,
              paddingHorizontal: space.m,
              backgroundColor: c.fill,
              borderRadius: radius.s,
            }}
          >
            <View style={{ flex: 1 }}>
              <T>{say(networkName(hostOfUrl(route)))}</T>
              <T mono size={font.caption} tone="muted" numberOfLines={1}>
                {hostOfUrl(route)}
              </T>
            </View>
            {computer.address === route ? <Check size={18} color={c.accent} /> : null}
          </Pressable>
        ))}
        <T size={font.caption} tone="muted">
          {say('Or enter another address')}
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
