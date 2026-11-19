import { useEffect, useMemo, useState } from 'react'
import { TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react-native'
import { findInRows } from '../runtime/chatFind'
import type { TranscriptItem } from '../runtime/types'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { Glass } from './Glass'
import { belowHeader } from './UndoToast'
import { IconButton, T } from './ui'

/** The bar's height, so a match the list scrolls to lands just under it. */
export const FIND_BAR_HEIGHT = 44

/**
 * Find in the loaded turns of a thread, as the desktop's thread header does: how many matches there are, and up and
 * down between them. It starts on the newest match, nearest where a chat is read, and Up goes back in time.
 */
export function ChatFindBar({
  rows,
  onJump,
  onClose,
}: {
  rows: readonly (TranscriptItem | { kind: string; id: string })[]
  onJump: (match: { id: string; index: number }, query: string) => void
  onClose: () => void
}) {
  const { c } = useTheme()
  const say = useSay()
  const insets = useSafeAreaInsets()
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const matches = useMemo(() => findInRows(rows, query), [rows, query])
  // A new query lands on its newest match; new output arriving keeps the one being read.
  useEffect(() => setCurrent(Math.max(0, matches.length - 1)), [query]) // eslint-disable-line react-hooks/exhaustive-deps -- a new query only
  const shown = Math.min(current, Math.max(0, matches.length - 1))
  const target = matches[shown]
  useEffect(() => {
    if (target) onJump(target, query.trim())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jumps when the match being read changes, not when the callback does
  }, [target?.id, target?.index, shown, query])
  const step = (delta: number) => {
    if (matches.length) setCurrent((shown + delta + matches.length) % matches.length)
  }
  return (
    <View style={{ position: 'absolute', left: space.m, right: space.m, top: belowHeader(insets.top), zIndex: 5 }}>
      <Glass radius={radius.full} style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: space.m, gap: 2 }}>
        <Search size={15} color={c.muted} />
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder={say('Find in conversation')}
          accessibilityLabel={say('Find in conversation')}
          placeholderTextColor={c.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => step(-1)}
          style={{ flex: 1, minHeight: FIND_BAR_HEIGHT, marginLeft: space.s, color: c.text, fontSize: font.control }}
        />
        {query.trim() ? (
          <T
            size={font.caption}
            tone="muted"
            style={{ fontVariant: ['tabular-nums'] }}
            accessibilityLiveRegion="polite"
          >
            {matches.length ? say('{0} of {1}', { 0: shown + 1, 1: matches.length }) : say('No matches')}
          </T>
        ) : null}
        <IconButton
          icon={ChevronUp}
          label={say('Previous match')}
          tone="muted"
          disabled={matches.length < 2}
          onPress={() => step(-1)}
        />
        <IconButton
          icon={ChevronDown}
          label={say('Next match')}
          tone="muted"
          disabled={matches.length < 2}
          onPress={() => step(1)}
        />
        <IconButton icon={X} label={say('Close find')} tone="muted" onPress={onClose} />
      </Glass>
    </View>
  )
}
