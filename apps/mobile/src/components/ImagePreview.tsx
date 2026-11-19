import { useEffect, useState, type ReactNode } from 'react'
import { Image, Pressable, ScrollView } from 'react-native'
import { useSay } from '../i18n'
import { radius, space, useTheme } from '../theme'
import { Card, Sheet, tap } from './ui'

/**
 * An image in the chat that opens large when tapped, pinch to zoom, so a screenshot or diagram an agent shares can be
 * read on a phone. The thumbnail is whatever the caller draws.
 */
export function ImagePreview({ uri, alt, children }: { uri: string; alt?: string; children: ReactNode }) {
  const say = useSay()
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const [ratio, setRatio] = useState(4 / 3)
  useEffect(() => {
    if (!open) return
    Image.getSize(
      uri,
      (w, h) => {
        if (w && h) setRatio(w / h)
      },
      () => {},
    )
  }, [open, uri])
  return (
    <>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={alt || say('Image')}
        accessibilityHint={say('Opens the image larger')}
        onPress={() => {
          tap()
          setOpen(true)
        }}
      >
        {children}
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title={alt || say('Image')}>
        <Card style={{ marginHorizontal: space.l, padding: space.s }}>
          <ScrollView
            maximumZoomScale={5}
            minimumZoomScale={1}
            bouncesZoom
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            style={{ borderRadius: radius.s, backgroundColor: c.code }}
          >
            <Image
              source={{ uri }}
              resizeMode="contain"
              accessibilityLabel={alt}
              style={{ width: '100%', aspectRatio: ratio, maxHeight: 560 }}
            />
          </ScrollView>
        </Card>
      </Sheet>
    </>
  )
}
