import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView } from 'react-native'
import type { Attachment } from '@ramu/shared/types'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { font, radius, space, useTheme } from '../theme'
import { Card, Sheet, T } from './ui'

/** Longest text drawn: a long log or source file shows its start rather than stalling the sheet. */
const SHOWN_CHARACTERS = 60_000

/**
 * A file attached to a message, read in a sheet as the desktop previews it: its text from the host, in the code face
 * and scrollable. A file that is not text (a PDF, an archive) says so. Pictures open in ImagePreview instead.
 */
export function AttachmentTextSheet({
  computerId,
  file,
  onClose,
}: {
  computerId: string
  file: Attachment | null
  onClose: () => void
}) {
  const say = useSay()
  const store = useStore()
  const { c } = useTheme()
  const [text, setText] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    setText(undefined)
    if (!file) return
    let alive = true
    void store.invoke(computerId, 'attachments.text', file.id).then(
      (value) => {
        if (alive) setText(value)
      },
      () => {
        if (alive) setText(null)
      },
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [file?.id, computerId] by design; the store's invoke is current as of that run
  }, [file?.id, computerId])
  return (
    <Sheet open={!!file} onClose={onClose} title={file?.name ?? ''}>
      <Card style={{ marginHorizontal: space.l, padding: space.m, minHeight: 120 }}>
        {text === undefined ? (
          <ActivityIndicator color={c.muted} style={{ marginTop: space.l }} />
        ) : text === null ? (
          <T tone="muted">{say('This file cannot be shown here.')}</T>
        ) : (
          <ScrollView style={{ maxHeight: 520, borderRadius: radius.s }} showsVerticalScrollIndicator>
            <T mono size={font.caption} selectable>
              {text.length > SHOWN_CHARACTERS ? `${text.slice(0, SHOWN_CHARACTERS)}\n…` : text}
            </T>
          </ScrollView>
        )}
      </Card>
    </Sheet>
  )
}
