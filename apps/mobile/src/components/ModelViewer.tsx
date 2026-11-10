import { useEffect, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Box } from 'lucide-react-native'
import { interactiveHtml } from '@ramu/shared/interactive'
import { interactiveThemeVariables } from '@ramu/shared/interactiveTheme'
import type { Attachment } from '@ramu/shared/types'
import { useStore } from '../runtime/store'
import { useSay } from '../i18n'
import { font, radius, space, useTheme } from '../theme'
import InteractiveFrame from './InteractiveFrame'
import { Card, Sheet, T, tap } from './ui'

export const isModelFile = (file: Pick<Attachment, 'mimeType'>) => file.mimeType.startsWith('model/')

/** A 3D model attachment: a chip that opens the host's model viewer, the same one the desktop shows, in a sheet. */
export function ModelTile({ file, computerId }: { file: Attachment; computerId: string }) {
  const say = useSay()
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={say('Open 3D model {0}', { '0': file.name })}
        onPress={() => {
          tap()
          setOpen(true)
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          height: 32,
          paddingHorizontal: 10,
          borderRadius: radius.s,
          backgroundColor: c.fill,
          maxWidth: 240,
        }}
      >
        <Box size={14} color={c.soft} />
        <T size={font.caption + 1} tone="soft" numberOfLines={1}>
          {file.name}
        </T>
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title={file.name}>
        <Card style={{ marginHorizontal: space.l, padding: space.s }}>
          {open ? <ModelSheetViewer file={file} computerId={computerId} /> : null}
        </Card>
      </Sheet>
    </>
  )
}

function ModelSheetViewer({ file, computerId }: { file: Attachment; computerId: string }) {
  const say = useSay()
  const store = useStore()
  const { c, scheme } = useTheme()
  const [document, setDocument] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [height, setHeight] = useState(460)
  const theme = useMemo(
    () =>
      interactiveThemeVariables({
        scheme,
        background: c.window,
        foreground: c.text,
        muted: c.muted,
        primary: c.accent,
        surface: c.raised2,
        surfaceRaised: c.bubble,
        codeBackground: c.code,
        button: c.primary,
        buttonForeground: c.primaryInk,
        success: c.ok,
        warning: c.warn,
        danger: c.bad,
      }),
    [c, scheme],
  )
  useEffect(() => {
    let alive = true
    store
      .invoke(computerId, 'attachments.modelViewer', file.id, {
        triangles: say('{0} triangles'),
        size: say('{0} m'),
        animation: say('Animation {0}'),
        still: say('No animation'),
        failed: say('This model could not be read.'),
      })
      .then(
        (html) => {
          if (alive) setDocument(html)
        },
        () => {
          if (alive) setError(say('Connect to this host to open the model.'))
        },
      )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [file.id, computerId] by design; the viewer's words are read once when it opens
  }, [file.id, computerId])
  const instance = `model:${file.id}`
  const html = useMemo(
    () => (document ? interactiveHtml(document, instance, null, theme) : ''),
    [document, instance, theme],
  )
  if (error)
    return (
      <T size={font.caption} tone="muted">
        {error}
      </T>
    )
  if (!html)
    return (
      <View style={{ height: 120, justifyContent: 'center', alignItems: 'center' }}>
        <T size={font.caption} tone="muted">
          {say('Loading model…')}
        </T>
      </View>
    )
  return (
    <InteractiveFrame
      html={html}
      title={file.name}
      instance={instance}
      height={height}
      theme={theme}
      onMessage={(value) => {
        const message = value as { type?: unknown; value?: unknown }
        if (message?.type === 'height' && typeof message.value === 'number')
          setHeight(Math.max(120, Math.min(900, message.value)))
      }}
      onStop={() => setError(say('This model could not be read.'))}
    />
  )
}
