import { useEffect, useMemo, useRef, useState } from 'react'
import { Image, PanResponder, View } from 'react-native'
import { SvgXml } from 'react-native-svg'
import type { ChangeFile } from '@ramu/shared/types'
import { formatSize } from '@ramu/shared/formatSize'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { font, radius, space, useTheme } from '../theme'
import { ImagePreview } from './ImagePreview'
import { Segmented, T } from './ui'

type Side = 'old' | 'new'
type Mode = 'old' | 'new' | 'swipe'
type Picture = { uri: string } | { xml: string }

const HEIGHT = 260

/** One side of a changed image: an SVG draws from the run's saved source, any other picture comes from the host. */
function usePicture(computerId: string, reviewId: string, file: ChangeFile, side: Side): Picture | null | undefined {
  const store = useStore()
  const wanted = side === 'old' ? file.status !== 'added' : file.status !== 'deleted'
  const xml = !file.binary ? (side === 'old' ? file.oldContent : file.newContent) : null
  const [uri, setUri] = useState<string | null | undefined>(wanted && file.binary ? undefined : null)
  useEffect(() => {
    if (!wanted || !file.binary) return
    let alive = true
    store.invoke(computerId, 'reviews.image', reviewId, file.id, side).then(
      (image) => alive && setUri(image),
      () => alive && setUri(null),
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `store` is stable for what this reads
  }, [computerId, reviewId, file.id, file.binary, side, wanted])
  if (!wanted) return null
  if (xml) return { xml }
  return uri === undefined ? undefined : uri ? { uri } : null
}

function Drawn({ picture, width }: { picture: Picture; width: number }) {
  return 'xml' in picture ? (
    <SvgXml xml={picture.xml} width={width} height={HEIGHT} />
  ) : (
    <Image source={{ uri: picture.uri }} resizeMode="contain" style={{ width, height: HEIGHT }} />
  )
}

/**
 * A changed image for a phone. Side by side would leave each picture too small, so it shows one side at a time (Before
 * or After, tap to open it large) or both stacked with a divider that follows the finger, like GitHub's Swipe.
 */
export function ReviewImageCompare({
  computerId,
  reviewId,
  file,
}: {
  computerId: string
  reviewId: string
  file: ChangeFile
}) {
  const say = useSay()
  const { c } = useTheme()
  const before = usePicture(computerId, reviewId, file, 'old')
  const after = usePicture(computerId, reviewId, file, 'new')
  const both = Boolean(before && after)
  const [mode, setMode] = useState<Mode>('swipe')
  const [width, setWidth] = useState(0)
  const [split, setSplit] = useState(0.5)
  const [dimensions, setDimensions] = useState<Record<Side, string | null>>({ old: null, new: null })
  useEffect(() => {
    for (const [side, picture] of [
      ['old', before],
      ['new', after],
    ] as const)
      if (picture && 'uri' in picture)
        Image.getSize(
          picture.uri,
          (w, h) => setDimensions((value) => ({ ...value, [side]: `${w}×${h}` })),
          () => {},
        )
  }, [before, after])
  const widthRef = useRef(0)
  widthRef.current = width
  const drag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        // Only a sideways drag moves the divider, so the page still scrolls under a vertical one.
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) =>
          widthRef.current && setSplit(Math.min(1, Math.max(0, event.nativeEvent.locationX / widthRef.current))),
        onPanResponderMove: (event) =>
          widthRef.current && setSplit(Math.min(1, Math.max(0, event.nativeEvent.locationX / widthRef.current))),
      }),
    [],
  )
  const detail = (side: Side) =>
    [dimensions[side], file.binary ? (side === 'old' ? file.oldSize : file.newSize) : undefined]
      .map((value) => (typeof value === 'number' ? formatSize(value) : value))
      .filter(Boolean)
      .join(' · ')
  const caption = (side: Side, label: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
      <T size={font.caption} weight="600" tone={side === 'old' ? 'bad' : 'ok'}>
        {label}
      </T>
      <T size={font.caption} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
        {detail(side)}
      </T>
    </View>
  )
  if (before === undefined || after === undefined)
    return (
      <T size={font.control} tone="muted" style={{ padding: space.m }}>
        {say('Loading image…')}
      </T>
    )
  if (!before && !after)
    return (
      <T size={font.control} tone="muted" style={{ padding: space.m }}>
        {say('This run kept no preview of this image.')}
      </T>
    )
  const frame = {
    height: HEIGHT,
    borderRadius: radius.s,
    backgroundColor: c.code,
    borderWidth: 0.5,
    borderColor: c.line,
    overflow: 'hidden' as const,
  }
  const single = (side: Side, picture: Picture) => (
    <View style={{ gap: space.xs }}>
      {caption(side, side === 'old' ? (both ? say('Before') : say('Deleted')) : both ? say('After') : say('Added'))}
      {'uri' in picture ? (
        <ImagePreview uri={picture.uri} alt={file.path.split('/').at(-1)}>
          <View style={frame}>{width ? <Drawn picture={picture} width={width} /> : null}</View>
        </ImagePreview>
      ) : (
        <View style={frame}>{width ? <Drawn picture={picture} width={width} /> : null}</View>
      )}
    </View>
  )
  return (
    <View
      style={{ padding: space.m, gap: space.s }}
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width - space.m * 2 - 1))}
    >
      {both ? (
        <Segmented
          small
          value={mode}
          onChange={setMode}
          options={[
            { key: 'old', label: say('Before') },
            { key: 'swipe', label: say('Swipe') },
            { key: 'new', label: say('After') },
          ]}
        />
      ) : null}
      {both && mode === 'swipe' ? (
        <View style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s }}>
            {caption('old', say('Before'))}
            {caption('new', say('After'))}
          </View>
          <View
            {...drag.panHandlers}
            accessibilityLabel={say('Swipe between before and after')}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(split * 100) }}
            style={frame}
          >
            {width ? (
              <>
                <Drawn picture={after!} width={width} />
                <View
                  style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: width * split, overflow: 'hidden' }}
                >
                  <Drawn picture={before!} width={width} />
                </View>
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: width * split - 1,
                    width: 2,
                    backgroundColor: c.primary,
                  }}
                />
              </>
            ) : null}
          </View>
        </View>
      ) : (
        single(
          before && (!both || mode === 'old') ? 'old' : 'new',
          (before && (!both || mode === 'old') ? before : after)!,
        )
      )}
    </View>
  )
}
