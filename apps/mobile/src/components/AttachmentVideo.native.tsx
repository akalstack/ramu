import { useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { useVideoPlayer, VideoView } from 'expo-video'
import { Play } from 'lucide-react-native'
import { useStore } from '../runtime/store'
import { useSay } from '../i18n'
import { font, radius, useTheme } from '../theme'
import { T, tap } from './ui'
import type { AttachmentVideoProps } from './AttachmentVideo'

const TILE = { width: 240, aspectRatio: 16 / 9 } as const

function Player({ uri, label }: { uri: string; label: string }) {
  const player = useVideoPlayer(uri, (created) => created.play())
  return (
    <VideoView
      player={player}
      nativeControls
      allowsPictureInPicture
      accessibilityLabel={label}
      style={{ ...TILE, backgroundColor: '#000', borderRadius: radius.m }}
    />
  )
}

/**
 * A video or recording sent in the thread, played from its host with the phone's own controls. It starts only when
 * tapped: the host gives a short-lived address for this one file, streamed with seeking rather than downloaded first.
 */
export default function AttachmentVideo({ file, computerId }: AttachmentVideoProps) {
  const store = useStore()
  const say = useSay()
  const { c } = useTheme()
  const [uri, setUri] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'opening' | 'failed'>('idle')
  const host = store.computers.find((entry) => entry.id === computerId)
  if (uri) return <Player uri={uri} label={file.name} />
  const open = () => {
    if (!host || state === 'opening') return
    tap()
    setState('opening')
    void store
      .invoke(computerId, 'attachments.stream', file.id)
      .then(({ path }) => setUri(`${host.address.replace(/\/+$/, '')}${path}`))
      .catch(() => setState('failed'))
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={say('Play {0}', { 0: file.name })}
      disabled={!host || !store.isOnline(computerId)}
      onPress={open}
      style={({ pressed }) => ({
        ...TILE,
        borderRadius: radius.m,
        backgroundColor: c.fill,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: 8,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.full,
          backgroundColor: c.text,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {state === 'opening' ? (
          <ActivityIndicator color={c.canvas} />
        ) : (
          <Play size={18} color={c.canvas} fill={c.canvas} />
        )}
      </View>
      <T size={font.caption} tone={state === 'failed' ? 'bad' : 'muted'} numberOfLines={1}>
        {state === 'failed' ? say('Could not play this video') : file.name}
      </T>
    </Pressable>
  )
}
