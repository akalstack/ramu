import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { SEARCH_RESULT_LIMIT } from '@ramu/shared/search/searchLimits'
import type { SearchMatch } from '@ramu/shared/types'
import { useSay } from '../i18n'
import { contentSearchOptions, groupSearchMatches } from '../runtime/contentSearch'
import { useStore } from '../runtime/store'
import { font, space, useTheme } from '../theme'
import { FileIcon } from './FileIcon'
import { PageLegendList } from './Screen'
import { T } from './ui'

type ResultRow =
  | { kind: 'file'; key: string; repoId: string; path: string; count: number }
  | { kind: 'match'; key: string; match: SearchMatch }

const SEARCH_DELAY_MS = 300
// A long line keeps a little text before the match so the match itself stays in the two lines shown.
const LEAD_CHARS = 32

/** Searches the checkout's file contents on the host and lists each file's matching lines; a tap opens that line. */
export function ExplorerContentSearch({
  host,
  context,
  query,
  online,
  repoNames,
  header,
  onOpen,
}: {
  host: string
  context: string
  query: string
  online: boolean
  /** Names files by repository when the checkout has several. */
  repoNames?: Record<string, string>
  /** The search choice and offline note, scrolled with the results. */
  header?: ReactNode
  onOpen: (repoId: string, path: string, line: number) => void
}) {
  const say = useSay()
  const store = useStore()
  const { c } = useTheme()
  const latest = useRef(store)
  latest.current = store
  const generation = useRef(0)
  const [result, setResult] = useState<{ matches: SearchMatch[]; limited: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    // Every keystroke, scope change or reconnect starts a new generation, so an older answer never replaces a newer one.
    const mine = ++generation.current
    setResult(null)
    setError('')
    if (!online || !query.trim()) {
      setBusy(false)
      return
    }
    setBusy(true)
    const timer = setTimeout(() => {
      void latest.current.invoke(host, 'files.search', context, contentSearchOptions(query)).then(
        (next) => {
          if (mine !== generation.current) return
          setResult({ matches: next.matches.slice(0, SEARCH_RESULT_LIMIT), limited: next.limited })
          setBusy(false)
        },
        (cause: unknown) => {
          if (mine !== generation.current) return
          setError(say('Search failed: {0}', { 0: cause instanceof Error ? cause.message : String(cause) }))
          setBusy(false)
        },
      )
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `say` is rebuilt each render; the search is keyed on what it asks the host
  }, [host, context, query, online])
  useEffect(
    () => () => {
      // Leaving the search drops whatever is still in flight.
      ++generation.current
    },
    [],
  )
  const rows = useMemo<ResultRow[]>(
    () =>
      groupSearchMatches(result?.matches ?? []).flatMap((group) => [
        {
          kind: 'file' as const,
          key: `${group.repoId}:${group.path}`,
          repoId: group.repoId,
          path: group.path,
          count: group.matches.length,
        },
        ...group.matches.map((match) => ({
          kind: 'match' as const,
          key: `${group.repoId}:${group.path}:${match.line}:${match.column}`,
          match,
        })),
      ]),
    [result],
  )
  return (
    <PageLegendList
      data={rows}
      keyExtractor={(row) => row.key}
      getItemType={(row) => row.kind}
      estimatedItemSize={44}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ paddingHorizontal: space.m, gap: space.s }}>
          {header}
          {error ? (
            <T tone="bad" style={{ padding: space.m }}>
              {error}
            </T>
          ) : null}
          {result?.limited ? (
            <T tone="muted" style={{ padding: space.m }}>
              {say('Showing the first {0} matches. Refine your search.', { 0: SEARCH_RESULT_LIMIT })}
            </T>
          ) : null}
          {busy ? <ActivityIndicator color={c.accent} accessibilityLabel={say('Searching…')} /> : null}
        </View>
      }
      ListEmptyComponent={
        result && !busy && !error ? (
          <T tone="muted" style={{ padding: space.l }}>
            {say('No matches in these files.')}
          </T>
        ) : undefined
      }
      renderItem={({ item: row }) => {
        if (row.kind === 'file') {
          const name = row.path.slice(row.path.lastIndexOf('/') + 1)
          const folder = [repoNames?.[row.repoId], row.path.slice(0, Math.max(0, row.path.lastIndexOf('/')))]
            .filter(Boolean)
            .join(' / ')
          return (
            <View
              accessibilityRole="header"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.s,
                paddingHorizontal: space.m,
                paddingTop: space.m,
                paddingBottom: space.xs,
              }}
            >
              <FileIcon path={name} size={15} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T weight="600" numberOfLines={1}>
                  {name}
                </T>
                {folder ? (
                  <T size={font.caption} tone="muted" numberOfLines={1} ellipsizeMode="head">
                    {folder}
                  </T>
                ) : null}
              </View>
              <T size={font.caption} tone="muted">
                {String(row.count)}
              </T>
            </View>
          )
        }
        const { match } = row
        const lead = match.text.slice(0, match.start).trimStart()
        const before = lead.length > LEAD_CHARS ? `…${lead.slice(-LEAD_CHARS)}` : lead
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={say('Line {0}: {1}', { 0: match.line, 1: match.text.trim() })}
            onPress={() => onOpen(match.repoId, match.path, match.line)}
            android_ripple={{ color: c.pressed }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: space.s,
              minHeight: 44,
              paddingVertical: space.s,
              paddingRight: space.m,
              paddingLeft: space.m + 15 + space.s,
              backgroundColor: pressed ? c.pressed : undefined,
            })}
          >
            <T mono size={font.caption} tone="muted" style={{ minWidth: 32, textAlign: 'right', lineHeight: 18 }}>
              {String(match.line)}
            </T>
            <T mono size={font.caption} numberOfLines={2} style={{ flex: 1, lineHeight: 18 }}>
              {before}
              <T mono size={font.caption} weight="600" style={{ backgroundColor: c.accentWash, lineHeight: 18 }}>
                {match.text.slice(match.start, match.end)}
              </T>
              {match.text.slice(match.end)}
            </T>
          </Pressable>
        )
      }}
    />
  )
}
