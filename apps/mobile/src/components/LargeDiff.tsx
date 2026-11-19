import { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { ChevronLeft, ChevronRight, Info, ListTree } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { SheetOption } from './SheetOptions'
import { Button, IconButton, Sheet, T } from './ui'

export interface JumpFile {
  path: string
  /** Line counts, when the list has them. */
  additions?: number
  deletions?: number
}

/**
 * Picks one file of a long change list: a search over the paths and a virtualized list, so hundreds of files open at
 * once. Each row shows the file's name, folder and line counts, and `counts` its comments.
 */
export function FileJumpSheet({
  open,
  files,
  counts,
  current,
  onPick,
  onClose,
}: {
  open: boolean
  files: readonly JumpFile[]
  counts?: ReadonlyMap<string, number>
  current?: string
  onPick: (path: string) => void
  onClose: () => void
}) {
  const say = useSay()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = useMemo(
    () => (needle ? files.filter((file) => file.path.toLowerCase().includes(needle)) : files),
    [files, needle],
  )
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={say('Jump to file')}
      scroll={false}
      search={{ value: query, onChangeText: setQuery, placeholder: say('Search files') }}
    >
      <FlatList
        data={shown}
        keyExtractor={(file) => file.path}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        windowSize={7}
        ListEmptyComponent={
          <T tone="muted" style={{ padding: space.l }}>
            {say('No files match')}
          </T>
        }
        renderItem={({ item }) => {
          const dir = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/') + 1) : ''
          const comments = counts?.get(item.path)
          return (
            <SheetOption
              title={item.path.slice(dir.length)}
              help={
                [dir, comments ? say('{0} comments', { 0: comments }) : ''].filter(Boolean).join(' · ') || undefined
              }
              selected={item.path === current}
              trailing={
                item.additions !== undefined ? (
                  <T size={font.caption} mono>
                    <T size={font.caption} mono tone="ok">{`+${item.additions} `}</T>
                    <T size={font.caption} mono tone="bad">{`−${item.deletions ?? 0}`}</T>
                  </T>
                ) : undefined
              }
              onPress={() => {
                onPick(item.path)
                onClose()
              }}
            />
          )
        }}
      />
    </Sheet>
  )
}

/**
 * The desktop's large-diff banner: a large change shows one file at a time, stepped with the arrows, and can show
 * every file instead. Jump to file is beside it, as the desktop's file tree is.
 */
export function LargeDiffBar({
  oneAtATime,
  index,
  count,
  onStep,
  onToggleAll,
  onJump,
}: {
  oneAtATime: boolean
  index: number
  count: number
  onStep: (delta: -1 | 1) => void
  onToggleAll: () => void
  onJump: () => void
}) {
  const say = useSay()
  const { c } = useTheme()
  return (
    <View
      accessibilityRole="summary"
      style={{
        gap: space.xs,
        padding: space.s,
        paddingLeft: space.m,
        borderRadius: radius.m,
        backgroundColor: c.raised2,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Info size={15} color={c.accent} />
        <T size={font.control} tone="soft" style={{ flex: 1 }}>
          {oneAtATime ? say('This diff is large, showing one file at a time') : say('This diff is large')}
        </T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        {oneAtATime ? (
          <>
            <IconButton
              icon={ChevronLeft}
              label={say('Previous file')}
              size={36}
              disabled={index <= 0}
              onPress={() => onStep(-1)}
            />
            <T size={font.caption} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
              {`${index + 1} / ${count}`}
            </T>
            <IconButton
              icon={ChevronRight}
              label={say('Next file')}
              size={36}
              disabled={index >= count - 1}
              onPress={() => onStep(1)}
            />
          </>
        ) : null}
        <View style={{ flex: 1 }} />
        <IconButton icon={ListTree} label={say('Jump to file')} size={36} onPress={onJump} />
        <Button kind="ghost" title={say(oneAtATime ? 'Show all files' : 'One file at a time')} onPress={onToggleAll} />
      </View>
    </View>
  )
}
