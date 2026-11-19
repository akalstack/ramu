import { useEffect, useState } from 'react'
import { Image, View } from 'react-native'
import { Bot } from 'lucide-react-native'
import { useStore } from '../runtime/store'
import { useTheme } from '../theme'
import { T } from './ui'

const pictures = new Map<string, string | null>()

/**
 * A comment author's picture, fetched through the host as on the desktop, or their initials on a neutral disc; a bot
 * without a picture shows the bot mark.
 */
export function CommentAvatar({
  computerId,
  name,
  url,
  bot,
  size = 24,
}: {
  computerId: string
  name: string | null
  url?: string
  bot?: boolean
  size?: number
}) {
  const { c } = useTheme()
  const store = useStore()
  const key = url ? `${computerId}|${url}` : ''
  const [picture, setPicture] = useState<string | null>(key ? (pictures.get(key) ?? null) : null)
  useEffect(() => {
    if (!url || pictures.has(key)) return
    let alive = true
    store.invoke(computerId, 'forge.avatar', url).then(
      (value) => {
        pictures.set(key, value)
        if (alive) setPicture(value)
      },
      () => {},
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetched once per host and address
  }, [key])
  const initials = (name ?? '?')
    .replace(/\[bot\]$/i, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        backgroundColor: c.fill,
        borderWidth: 1,
        borderColor: c.line,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {picture ? (
        <Image source={{ uri: picture }} style={{ width: size, height: size }} />
      ) : bot ? (
        <Bot size={Math.round(size * 0.55)} color={c.soft} />
      ) : (
        <T size={Math.round(size * 0.4)} tone="soft" weight="600">
          {initials || '?'}
        </T>
      )}
    </View>
  )
}
