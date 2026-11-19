import { useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { forgeSegments, type ForgeSegment } from '../runtime/forgeMarkdown'
import { font, radius, space, useTheme } from '../theme'
import { translate } from '@ramu/shared/i18n'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { Markdown } from './Markdown'
import { Disclosure } from './Motion'
import { T, tap } from './ui'

/** A <details> fold: closed unless the author opened it, as GitHub shows it, with its body read the same way. */
function Fold({ segment }: { segment: Extract<ForgeSegment, { kind: 'details' }> }) {
  const say = useSay()
  const { c } = useTheme()
  const [open, setOpen] = useState(segment.open)
  return (
    <View style={{ borderRadius: radius.s, backgroundColor: c.fill, paddingHorizontal: space.m }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={4}
        onPress={() => {
          tap()
          setOpen((value) => !value)
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 36 }}
      >
        <Disclosure open={open} size={13} color={c.muted} />
        <T size={font.control} weight="500" tone="soft" style={{ flex: 1 }}>
          {segment.summary || say('Details')}
        </T>
      </Pressable>
      {open ? (
        <View style={{ paddingBottom: space.s }}>
          <PullRequestMarkdown text={segment.body} />
        </View>
      ) : null}
    </View>
  )
}

/**
 * A pull request's description or comment as the hosting service shows it: GitHub-flavored Markdown, its HTML drawn as
 * the same Markdown, hidden comments left out, <details> folded, and suggestions shown as the lines they add.
 */
export function PullRequestMarkdown({ text }: { text: string }) {
  const { language } = useStore()
  const segments = useMemo(() => forgeSegments(text, (key) => translate(language, key)), [text, language])
  return (
    <View style={{ gap: space.s }}>
      {segments.map((segment, index) =>
        segment.kind === 'markdown' ? (
          <Markdown key={index} text={segment.text} />
        ) : (
          <Fold key={index} segment={segment} />
        ),
      )}
    </View>
  )
}
