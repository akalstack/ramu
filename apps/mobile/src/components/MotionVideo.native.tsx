import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { File, Paths } from 'expo-file-system'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useStore } from '../runtime/store'
import { useSay } from '../i18n'
import { useTheme } from '../theme'
import { T } from './ui'
import type { MotionVideoProps } from './MotionVideo'

function Player({ uri, label }: { uri: string; label: string }) {
  const player = useVideoPlayer(uri, (created) => created.play())
  return (
    <VideoView
      player={player}
      nativeControls
      accessibilityLabel={label}
      style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 10 }}
    />
  )
}

/**
 * A motion as the native video the host exports (MP4), played with the phone's own controls, picture and AirPlay
 * included. The file is kept in the cache per version, so it is made once.
 */
export default function MotionVideo({ computerId, artifactId, version, title, onError }: MotionVideoProps) {
  const store = useStore()
  const { c } = useTheme()
  const say = useSay()
  const [uri, setUri] = useState<string | null>(null)
  const failed = useRef(onError)
  useEffect(() => {
    failed.current = onError
  }, [onError])
  useEffect(() => {
    let live = true
    const file = new File(Paths.cache, `ramu-motion-${artifactId}-${version}.mp4`)
    if (file.exists) {
      setUri(file.uri)
      return
    }
    void store
      .invoke(computerId, 'artifacts.export', artifactId, version, 'mp4')
      .then(async (exported) => {
        await file.write(exported.content, { encoding: 'base64' })
        if (live) setUri(file.uri)
      })
      .catch((failure: unknown) => failed.current(failure instanceof Error ? failure.message : String(failure)))
    return () => {
      live = false
    }
  }, [store, computerId, artifactId, version])
  if (!uri)
    return (
      <View style={{ aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <ActivityIndicator color={c.accent} />
        <T tone="muted">{say('Making the video…')}</T>
      </View>
    )
  return <Player uri={uri} label={title} />
}
