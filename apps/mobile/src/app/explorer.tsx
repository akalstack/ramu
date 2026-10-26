import { BottomSearch } from '../components/BottomSearch'
import { translate } from '@ramu/shared/i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  File,
  Files,
  FileText,
  Folder,
  FolderInput,
  FolderGit2,
  RefreshCw,
  GitBranch,
  ListCollapse,
  Pencil,
  Share2,
  Trash2,
} from 'lucide-react-native'
import type { DirEntry, RepositoryBinding } from '@ramu/shared/types'
import {
  explorerKey,
  EXPLORER_SEARCH_LIMIT,
  flattenExplorer,
  searchExplorerFiles,
  projectExplorerContext,
  projectWorkspaces,
  explorerAncestors,
} from '@ramu/shared/workspace/explorer'
import { useStore } from '../runtime/store'
import { useWorkspaces } from '../runtime/useWorkspaces'
import { fill, useT } from '../i18n'
import { duplicateName, explorerActions, parentFolder, planMove, planRename } from '../runtime/explorerActions'
import { shareDownloadedFile } from '../runtime/explorerShare'
import { HostError } from '../runtime/transport'
import { readExplorerNavigation } from '../runtime/explorerNavigation'
import { font, radius, space, useTheme } from '../theme'
import { Header, HeaderButton, PageFlatList, Screen } from '../components/Screen'
import { Button, Row, Sheet, T } from '../components/ui'
import { SheetGroup, SheetOption } from '../components/SheetOptions'

type ExplorerScope = { host: string; context: string; label?: string }
/** A tree row. With several repositories each one gets a `root` row (path '') and its files sit one level below. */
type ExplorerRow = { repoId: string; entry: DirEntry; depth: number; root?: boolean }
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

export default function Explorer() {
  const params = useLocalSearchParams<{
    computer?: string
    ctx?: string
    repoId?: string
    path?: string
    composerProject?: string
    draftContext?: string
    revealId?: string
  }>()
  const store = useStore()
  const router = useRouter()
  const t = useT()
  const { c } = useTheme()
  const routeKey = JSON.stringify([params.computer, params.ctx])
  const routeScope: ExplorerScope | null =
    params.computer && params.ctx ? { host: params.computer, context: params.ctx } : null
  const [scopeSelection, setScopeSelection] = useState<{ routeKey: string; value: ExplorerScope | null }>(() => ({
    routeKey,
    value: routeScope,
  }))
  const scope = scopeSelection.routeKey === routeKey ? scopeSelection.value : routeScope
  const setScope = (value: ExplorerScope | null) => setScopeSelection({ routeKey, value })
  const list = useRef<import('react-native').FlatList<ExplorerRow>>(null)
  const selected =
    scope && params.computer === scope.host && params.ctx === scope.context && params.repoId && params.path
      ? { repoId: params.repoId, path: params.path }
      : undefined
  const revealed = useRef('')
  const revealKey = selected
    ? JSON.stringify([scope?.host, scope?.context, selected.repoId, selected.path, params.revealId])
    : ''
  useEffect(() => {
    if (!selected) return
    setQuery('')
    // A reveal opens the repository it points into, even if that root was folded.
    setClosedRoots((current) => {
      if (!current.has(selected.repoId)) return current
      const next = new Set(current)
      next.delete(selected.repoId)
      return next
    })
  }, [revealKey])
  const [project, setProject] = useState<(typeof store.projects)[number] | null>(null)
  const catalog = useWorkspaces(project?.computerId ?? '', !!project && !scope)
  const workspaces = project ? projectWorkspaces(project.computerId, project.id, catalog.rows) : []
  const [bindings, setBindings] = useState<RepositoryBinding[]>([])
  const [directories, setDirectories] = useState<Record<string, Record<string, DirEntry[]>>>({})
  const [continuations, setContinuations] = useState<
    Record<string, { repoId: string; path: string; cursor: string; loading?: boolean }>
  >({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Repository roots start open; this holds the folded ones, apart from `expanded` so saved folder keys keep their shape.
  const [closedRoots, setClosedRoots] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<{ repoId: string; path: string }[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revision, reload] = useState(0)
  const epoch = useRef(0)
  const lastScope = useRef('')
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings
  const inFlight = useRef(new Set<string>())
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())
  const online = scope ? store.isOnline(scope.host) : false
  const viewOnly = scope ? store.computers.find((computer) => computer.id === scope.host)?.access === 'viewer' : false
  // The row whose actions are open, and its rename draft; closing the sheet changes nothing.
  const [acting, setActing] = useState<{ repoId: string; entry: DirEntry } | null>(null)
  const [renameDraft, setRenameDraft] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [acted, setActed] = useState(false)
  const [moving, setMoving] = useState(false)
  // Whether an agent is writing in the checkout of the row whose actions are open; asked while the sheet is open.
  const [writerActive, setWriterActive] = useState(false)
  const closeActions = () => {
    setActing(null)
    setRenameDraft(null)
    setMoving(false)
    setWriterActive(false)
    setActionError('')
  }
  useEffect(() => {
    if (!acting || !scope || !online) return
    let current = true
    store
      .invoke(scope.host, 'files.writer', scope.context, acting.repoId)
      .then((result) => current && setWriterActive(result.active))
      .catch(() => current && setWriterActive(false))
    return () => {
      current = false
    }
  }, [acting?.repoId, acting?.entry.path])
  /** Reads a file's text from the host (bounded there) and hands it to the device's clipboard or share sheet. */
  const withContents = async (consume: (text: string) => Promise<unknown> | void) => {
    if (!scope || !acting || acted) return
    setActed(true)
    setActionError('')
    try {
      const file = await store.invoke(scope.host, 'files.read', scope.context, acting.repoId, acting.entry.path)
      await consume(file.content)
      closeActions()
    } catch (cause) {
      setActionError(`${t.explorerUnreadable} ${String(cause instanceof Error ? cause.message : cause)}`)
    } finally {
      setActed(false)
    }
  }
  /** Runs a change on the host, then reloads only the folder it touched. A failure keeps the sheet open to retry. */
  const change = async (work: () => Promise<unknown>, folder: string, repoId: string) => {
    if (!scope || acted) return
    setActed(true)
    setActionError('')
    try {
      await work()
      closeActions()
      const binding = bindingsRef.current.find((entry) => entry.repoId === repoId)
      if (binding) void loadDirectory(binding, folder)
    } catch (cause) {
      if (cause instanceof HostError && cause.ambiguous) {
        // The host may have applied it: reload instead of offering a blind retry, and let the person check.
        const binding = bindingsRef.current.find((entry) => entry.repoId === repoId)
        if (binding) void loadDirectory(binding, folder)
        setActionError(t.explorerAmbiguous)
      } else setActionError(`${t.explorerActionFailed} ${String(cause instanceof Error ? cause.message : cause)}`)
    } finally {
      setActed(false)
    }
  }
  const scopeIdentity = scope ? JSON.stringify([scope.host, scope.context]) : ''
  const activeScope = useRef(scopeIdentity)
  activeScope.current = scopeIdentity
  const navigation = useRef({
    identity: '',
    host: '',
    context: '',
    expanded: [] as string[],
    offset: 0,
    restored: false,
  })
  const saveNavigation = () => {
    const value = navigation.current
    if (value.identity)
      store.rememberExplorer(value.host, value.context, { expanded: value.expanded, offset: value.offset })
  }
  if (navigation.current.identity === scopeIdentity && !loading && !query) navigation.current.expanded = [...expanded]
  useEffect(() => {
    if (loading || query || navigation.current.identity !== scopeIdentity) return
    const timer = setTimeout(saveNavigation, 350)
    return () => clearTimeout(timer)
  }, [expanded, loading, query, scopeIdentity])
  useFocusEffect(useCallback(() => () => saveNavigation(), []))
  const loadDirectory = async (binding: RepositoryBinding, path: string, version = epoch.current, cursor?: string) => {
    if (!scope || binding.setupState !== 'ready' || activeScope.current !== scopeIdentity || version !== epoch.current)
      return
    const key = `${version}:${explorerKey(scope.host, scope.context, binding.repoId, path)}`
    if (inFlight.current.has(key)) return
    inFlight.current.add(key)
    const loadingKey = `${binding.repoId}:${path}`
    setLoadingDirs((all) => new Set(all).add(loadingKey))
    const directoryKey = explorerKey(scope.host, scope.context, binding.repoId, path)
    if (cursor)
      setContinuations((all) => ({ ...all, [directoryKey]: { repoId: binding.repoId, path, cursor, loading: true } }))
    try {
      const { entries, truncated, nextCursor } = cursor
        ? await store.invoke(scope.host, 'files.browse', scope.context, binding.repoId, path, cursor)
        : await store.invoke(scope.host, 'files.browse', scope.context, binding.repoId, path)
      if (version === epoch.current && activeScope.current === scopeIdentity) {
        if (truncated && !nextCursor) setError(t.explorerTruncated)
        setDirectories((all) => ({
          ...all,
          [binding.repoId]: {
            ...all[binding.repoId],
            [path]: cursor ? [...(all[binding.repoId]?.[path] ?? []), ...entries] : entries,
          },
        }))
        setContinuations((all) => {
          const next = { ...all }
          if (nextCursor) next[directoryKey] = { repoId: binding.repoId, path, cursor: nextCursor }
          else delete next[directoryKey]
          return next
        })
        return entries
      }
    } catch (cause) {
      if (version === epoch.current && activeScope.current === scopeIdentity) {
        setError(String(cause instanceof Error ? cause.message : cause))
        if (cursor) setContinuations((all) => ({ ...all, [directoryKey]: { repoId: binding.repoId, path, cursor } }))
      }
    } finally {
      inFlight.current.delete(key)
      setLoadingDirs((all) => {
        const next = new Set(all)
        next.delete(loadingKey)
        return next
      })
    }
  }
  useEffect(() => {
    const version = ++epoch.current
    const identity = JSON.stringify([scope?.host, scope?.context])
    if (lastScope.current !== identity || !online) {
      if (navigation.current.identity !== scopeIdentity) {
        saveNavigation()
        const saved = scope
          ? readExplorerNavigation(store.drafts, scope.host, scope.context)
          : { expanded: [], offset: 0 }
        navigation.current = {
          identity: scopeIdentity,
          host: scope?.host ?? '',
          context: scope?.context ?? '',
          expanded: saved.expanded,
          offset: saved.offset,
          restored: false,
        }
      }
      setBindings([])
      setDirectories({})
      setClosedRoots(new Set())
      setExpanded(new Set(navigation.current.expanded))
      setMatches([])
      setQuery('')
    }
    lastScope.current = identity
    setContinuations({})
    setError('')
    if (!scope || !online) {
      setLoading(false)
      return
    }
    setLoading(true)
    void store
      .invoke(scope.host, 'files.explorerBindings', scope.context)
      .then(
        async (next) => {
          if (version !== epoch.current) return
          setBindings(next)
          if (selected && !next.some((binding) => binding.repoId === selected.repoId)) setError(t.explorerRevealMissing)
          for (const binding of next) {
            const rootEntries = await loadDirectory(binding, '', version)
            const refreshed = new Map<string, DirEntry[] | undefined>([['', rootEntries]])
            for (const path of Object.keys(directories[binding.repoId] ?? {}).filter(Boolean))
              refreshed.set(path, await loadDirectory(binding, path, version))
            const savedPaths = navigation.current.expanded
              .filter((key) => key.startsWith(`${binding.repoId}:`))
              .map((key) => key.slice(binding.repoId.length + 1))
              .sort((a, b) => a.split('/').length - b.split('/').length)
            for (const path of savedPaths) {
              if (version !== epoch.current) return
              if (!refreshed.has(path)) refreshed.set(path, await loadDirectory(binding, path, version))
            }
            if (selected?.repoId === binding.repoId && revealed.current !== revealKey) {
              const ancestors = explorerAncestors(selected.path)
              if (!ancestors.length) {
                if (version === epoch.current) setError(t.explorerRevealMissing)
                continue
              }
              let parent: DirEntry[] | undefined = rootEntries
              for (const path of ancestors.filter(Boolean)) {
                if (version !== epoch.current) return
                parent = refreshed.has(path) ? refreshed.get(path) : await loadDirectory(binding, path, version)
                refreshed.set(path, parent)
              }
              if (version === epoch.current && revealed.current !== revealKey) {
                if (parent?.some((entry) => entry.kind === 'file' && entry.path === selected.path))
                  revealed.current = revealKey
                setExpanded(
                  (current) =>
                    new Set([...current, ...ancestors.filter(Boolean).map((path) => `${binding.repoId}:${path}`)]),
                )
                if (!parent?.some((entry) => entry.kind === 'file' && entry.path === selected.path))
                  setError(t.explorerRevealMissing)
              }
            }
          }
        },
        (cause) => {
          if (version === epoch.current) setError(String(cause))
        },
      )
      .finally(() => {
        if (version === epoch.current) setLoading(false)
      })
    return () => {
      ++epoch.current
    }
  }, [scope?.host, scope?.context, online, revision, selected?.repoId, selected?.path, revealKey])
  useFocusEffect(
    useCallback(() => {
      if (!scope) return
      reload((value) => value + 1)
      let timer: ReturnType<typeof setTimeout> | undefined
      const unwatch = store.watch(scope.host, ['fs:changed'])
      const off = store.subscribe(scope.host, (channel, payload) => {
        if (channel === 'fs:changed' && bindingsRef.current.some((b) => b.cwd === payload.cwd)) {
          clearTimeout(timer)
          timer = setTimeout(() => reload((value) => value + 1), 300)
        }
      })
      return () => {
        clearTimeout(timer)
        off()
        unwatch()
      }
    }, [scope?.host, scope?.context]),
  )
  useEffect(() => {
    let alive = true
    setMatches([])
    if (!scope || !online || !query.trim()) return
    const timer = setTimeout(() => {
      void store.invoke(scope.host, 'files.all', scope.context).then(
        (all) => {
          if (alive) setMatches(searchExplorerFiles(all, query, EXPLORER_SEARCH_LIMIT + 1))
        },
        (cause) => {
          if (alive) setError(String(cause))
        },
      )
    }, 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [scope?.host, scope?.context, online, query, revision])
  const multiRoot = bindings.length > 1
  const rows = useMemo<ExplorerRow[]>(
    () =>
      query.trim()
        ? matches.slice(0, EXPLORER_SEARCH_LIMIT).map((entry) => ({
            repoId: entry.repoId,
            entry: { name: baseName(entry.path), path: entry.path, kind: 'file' as const },
            depth: 0,
          }))
        : bindings.flatMap((binding) =>
            multiRoot
              ? [
                  {
                    repoId: binding.repoId,
                    entry: { name: binding.repoName, path: '', kind: 'dir' as const },
                    depth: 0,
                    root: true,
                  },
                  ...(closedRoots.has(binding.repoId)
                    ? []
                    : flattenExplorer(binding.repoId, directories[binding.repoId] ?? {}, expanded, '', 1)),
                ]
              : flattenExplorer(binding.repoId, directories[binding.repoId] ?? {}, expanded),
          ),
    [bindings, directories, expanded, closedRoots, multiRoot, query, matches],
  )
  useEffect(() => {
    if (!selected || query || loading) return
    const index = rows.findIndex((row) => row.repoId === selected.repoId && row.entry.path === selected.path)
    if (index < 0) return
    const frame = requestAnimationFrame(() =>
      list.current?.scrollToIndex({ index, viewPosition: 0.4, animated: false }),
    )
    return () => cancelAnimationFrame(frame)
  }, [selected?.repoId, selected?.path, rows, query, loading])
  useEffect(() => {
    const value = navigation.current
    if (selected || query || loading || !rows.length || value.identity !== scopeIdentity || value.restored) return
    const frame = requestAnimationFrame(() => {
      if (navigation.current !== value) return
      list.current?.scrollToOffset({ offset: value.offset, animated: false })
      value.restored = true
    })
    return () => cancelAnimationFrame(frame)
  }, [rows, loading, query, selected?.repoId, selected?.path, scopeIdentity])
  const open = (repoId: string, path: string) =>
    scope &&
    activeScope.current === scopeIdentity &&
    router.push({
      pathname: '/file',
      params: {
        computer: scope.host,
        ctx: scope.context,
        repoId,
        path,
        ...(params.composerProject && params.computer === scope.host && params.ctx === scope.context
          ? {
              composerProject: params.composerProject,
              ...(params.draftContext ? { draftContext: params.draftContext } : {}),
            }
          : {}),
      },
    })
  const available = acting ? explorerActions({ online, viewOnly, kind: acting.entry.kind }) : []
  return (
    <Screen>
      <Header
        scrollEdge
        title={t.explorerTitle}
        subtitle={
          <T size={font.caption} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {scope
              ? `${store.computers.find((h) => h.id === scope.host)?.name ?? t.hostUnavailable} · ${scope.label ?? (scope.context.startsWith('project:') ? t.currentCheckout : t.threadFiles)}`
              : project
                ? `${project.name} · ${t.chooseCheckout}`
                : t.chooseHostProject}
          </T>
        }
        right={
          scope ? (
            // Siblings in a fragment (not a View) so iOS renders each as a native toolbar button.
            <>
              <HeaderButton
                icon={Folder}
                label={t.changeCheckout}
                systemIcon="folder"
                onPress={() => {
                  setScope(null)
                  setProject(null)
                }}
              />
              <HeaderButton
                icon={ListCollapse}
                label={t.collapseFolders}
                systemIcon="rectangle.compress.vertical"
                onPress={() => {
                  revealed.current = revealKey
                  setExpanded(new Set())
                  // With several repositories, collapsing all leaves just the repository list.
                  if (multiRoot) setClosedRoots(new Set(bindings.map((binding) => binding.repoId)))
                }}
              />
              <HeaderButton
                icon={RefreshCw}
                label={t.refreshFiles}
                systemIcon="arrow.clockwise"
                onPress={() => reload((value) => value + 1)}
              />
            </>
          ) : project ? (
            <HeaderButton icon={Folder} label={t.changeCheckout} systemIcon="folder" onPress={() => setProject(null)} />
          ) : undefined
        }
      />
      {!scope ? (
        <PageFlatList
          contentInsetAdjustmentBehavior="automatic"
          data={project ? [] : store.projects}
          keyExtractor={(project) => project.id}
          renderItem={({ item }) => (
            <Row onPress={() => setProject(item)}>
              {item.kind === 'workspace' ? (
                <Folder size={18} color={c.soft} />
              ) : (
                <FolderGit2 size={18} color={c.soft} />
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <T numberOfLines={1}>{item.name}</T>
                <T tone="muted" size={font.caption} numberOfLines={1}>
                  {[
                    store.computers.length > 1
                      ? store.computers.find((h) => h.id === item.computerId)?.name
                      : undefined,
                    item.kind === 'workspace'
                      ? translate(store.language, '{count} repos', { count: item.repos.length })
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ') || store.computers.find((h) => h.id === item.computerId)?.name}
                </T>
              </View>
              <ChevronRight size={16} color={c.muted} />
            </Row>
          )}
          ListEmptyComponent={
            project ? (
              <>
                <Row
                  onPress={() =>
                    setScope({
                      host: project.computerId,
                      context: projectExplorerContext(project.computerId, project.id),
                      label: `${project.name} · ${t.currentCheckout}`,
                    })
                  }
                >
                  <Folder size={18} color={c.soft} />
                  <T>{t.currentCheckout}</T>
                </Row>
                {!store.isOnline(project.computerId) ? (
                  <T style={{ padding: space.m }} tone="muted">
                    {t.explorerOffline}
                  </T>
                ) : null}
                {catalog.loading ? <ActivityIndicator color={c.accent} /> : null}
                {catalog.error ? (
                  <Row onPress={catalog.refresh}>
                    <T tone="muted">{catalog.unsupported ? t.workspacesUnsupported : t.workspacesLoadFailed}</T>
                  </Row>
                ) : null}
                {workspaces.map((workspace) => (
                  <Row
                    key={workspace.id}
                    onPress={() =>
                      setScope({
                        host: project.computerId,
                        context: `worktree:${workspace.id}`,
                        label: `${project.name} · ${workspace.name}`,
                      })
                    }
                  >
                    <GitBranch size={18} color={c.soft} />
                    <View style={{ flex: 1 }}>
                      <T>{workspace.name}</T>
                      <T tone="muted" size={font.caption}>
                        {t.existingWorkspace}
                      </T>
                    </View>
                  </Row>
                ))}
              </>
            ) : (
              <T style={{ padding: space.l }}>{t.explorerNoProjects}</T>
            )
          }
        />
      ) : (
        <>
          <PageFlatList
            ref={list}
            onScroll={(event) => {
              if (!query && navigation.current.identity === scopeIdentity)
                navigation.current.offset = event.nativeEvent.contentOffset.y
            }}
            scrollEventThrottle={100}
            onMomentumScrollEnd={saveNavigation}
            onScrollEndDrag={saveNavigation}
            onScrollToIndexFailed={(info) =>
              list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false })
            }
            data={rows}
            keyExtractor={(row) => explorerKey(scope.host, scope.context, row.repoId, row.entry.path)}
            contentInsetAdjustmentBehavior="automatic"
            ListHeaderComponent={
              <View style={{ paddingHorizontal: space.m, gap: space.s }}>
                {!online ? (
                  <T tone="muted" style={{ padding: space.m }}>
                    {t.explorerOffline}
                  </T>
                ) : null}
                {error ? (
                  <T tone="bad" style={{ padding: space.m }}>
                    {error}
                  </T>
                ) : null}
                {matches.length > EXPLORER_SEARCH_LIMIT ? (
                  <T tone="muted" style={{ padding: space.m }}>
                    {t.explorerMoreMatches}
                  </T>
                ) : null}
                {loading ? <ActivityIndicator color={c.accent} /> : null}

                {/* One repository is named once up here; several get their own root rows in the tree instead. */}
                {(multiRoot ? [] : bindings).map((binding) => (
                  <View key={binding.repoId} style={{ paddingHorizontal: space.xs, paddingTop: space.xs }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                      <FolderGit2 size={14} color={c.soft} />
                      <T weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {binding.repoName}
                      </T>
                      {binding.taskBranch ? (
                        <>
                          <GitBranch size={12} color={c.muted} />
                          <T mono size={font.caption} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                            {binding.taskBranch}
                          </T>
                        </>
                      ) : null}
                    </View>
                    <T tone="muted" size={font.caption} numberOfLines={1} ellipsizeMode="head">
                      {binding.cwd}
                    </T>
                    {binding.setupState !== 'ready' ? (
                      <T tone="bad" size={font.caption}>
                        {binding.setupError ?? t.workspaceUnavailable}
                      </T>
                    ) : null}
                  </View>
                ))}
              </View>
            }
            ListFooterComponent={
              !query.trim() ? (
                <View>
                  {Object.entries(continuations)
                    .filter(([, page]) =>
                      explorerAncestors(`${page.path ? `${page.path}/` : ''}entry`)
                        .filter(Boolean)
                        .every((path) => expanded.has(`${page.repoId}:${path}`)),
                    )
                    .map(([key, page]) => {
                      const binding = bindings.find((binding) => binding.repoId === page.repoId)
                      return binding ? (
                        <Row
                          key={key}
                          disabled={!online || loading || page.loading}
                          onPress={() => void loadDirectory(binding, page.path, epoch.current, page.cursor)}
                        >
                          {page.loading ? <ActivityIndicator color={c.accent} /> : null}
                          <T>{`${t.loadMoreFiles} · ${binding.repoName}${page.path ? `/${page.path}` : ''}`}</T>
                        </Row>
                      ) : null
                    })}
                </View>
              ) : undefined
            }
            renderItem={({ item: row }) => {
              const binding = bindings.find((b) => b.repoId === row.repoId)!
              const key = `${row.repoId}:${row.entry.path}`
              if (row.root) {
                const rootOpen = !closedRoots.has(row.repoId)
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={row.entry.name}
                    accessibilityState={{ expanded: rootOpen }}
                    onPress={() =>
                      setClosedRoots((current) => {
                        const next = new Set(current)
                        if (!next.delete(row.repoId)) next.add(row.repoId)
                        return next
                      })
                    }
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.s,
                      minHeight: 48,
                      marginTop: rows[0] === row ? 0 : space.s,
                      paddingVertical: space.s,
                      paddingHorizontal: space.m,
                      backgroundColor: pressed ? c.pressed : undefined,
                    })}
                  >
                    {rootOpen ? <ChevronDown size={15} color={c.soft} /> : <ChevronRight size={15} color={c.soft} />}
                    <FolderGit2 size={16} color={c.soft} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T weight="600" numberOfLines={1}>
                        {row.entry.name}
                      </T>
                      {binding?.setupState !== 'ready' ? (
                        <T tone="bad" size={font.caption} numberOfLines={2}>
                          {binding?.setupError ?? t.workspaceUnavailable}
                        </T>
                      ) : binding.taskBranch ? (
                        <T mono size={font.caption} tone="muted" numberOfLines={1}>
                          {binding.taskBranch}
                        </T>
                      ) : null}
                    </View>
                    {loadingDirs.has(key) ? <ActivityIndicator color={c.accent} /> : null}
                  </Pressable>
                )
              }
              const isOpen = expanded.has(key)
              // Search results name the file, then where it lives (and in which repository when there are several).
              const where = query.trim()
                ? [multiRoot ? binding?.repoName : undefined, parentFolder(row.entry.path) || undefined]
                    .filter(Boolean)
                    .join(' / ')
                : ''
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${binding?.repoName ?? row.repoId}/${row.entry.path}`}
                  accessibilityState={
                    row.entry.kind === 'dir'
                      ? { expanded: isOpen }
                      : { selected: selected?.repoId === row.repoId && selected.path === row.entry.path }
                  }
                  accessibilityHint={t.explorerCopyHint}
                  onLongPress={() => setActing({ repoId: row.repoId, entry: row.entry })}
                  onPress={() => {
                    if (activeScope.current !== scopeIdentity) return
                    if (row.entry.kind === 'file') {
                      open(row.repoId, row.entry.path)
                      return
                    }
                    setExpanded((current) => {
                      const next = new Set(current)
                      if (next.has(key)) next.delete(key)
                      else next.add(key)
                      return next
                    })
                    if (!directories[row.repoId]?.[row.entry.path]) void loadDirectory(binding, row.entry.path)
                  }}
                  style={{
                    flexDirection: 'row',
                    backgroundColor:
                      selected?.repoId === row.repoId && selected.path === row.entry.path ? c.accentWash : undefined,
                    alignItems: 'center',
                    gap: space.s,
                    minHeight: 44,
                    paddingVertical: space.s,
                    paddingRight: space.m,
                    paddingLeft: space.m + Math.min(row.depth, 8) * 14,
                  }}
                >
                  {/* Folder and file names line up: folders lead with a chevron, files with the same width of space. */}
                  {row.entry.kind === 'dir' ? (
                    isOpen ? (
                      <ChevronDown size={15} color={c.soft} />
                    ) : (
                      <ChevronRight size={15} color={c.soft} />
                    )
                  ) : query.trim() ? null : (
                    <View style={{ width: 15 }} />
                  )}
                  {row.entry.kind === 'dir' ? <Folder size={15} color={c.soft} /> : <File size={15} color={c.muted} />}
                  <View style={{ flex: 1 }}>
                    <T numberOfLines={2}>{row.entry.name}</T>
                    {where ? (
                      <T size={font.caption} tone="muted" numberOfLines={1} ellipsizeMode="head">
                        {where}
                      </T>
                    ) : null}
                    {row.entry.kind === 'dir' && isOpen && directories[row.repoId]?.[row.entry.path]?.length === 0 ? (
                      <T size={font.caption} tone="muted">
                        {t.explorerEmptyFolder}
                      </T>
                    ) : null}
                  </View>
                  {row.entry.kind === 'dir' && loadingDirs.has(key) ? <ActivityIndicator color={c.accent} /> : null}
                </Pressable>
              )
            }}
            ListEmptyComponent={
              !loading && online ? (
                <T tone="muted" style={{ padding: space.l }}>
                  {query ? t.explorerNoMatches : t.explorerNoFiles}
                </T>
              ) : undefined
            }
          />
        </>
      )}
      <Sheet open={!!acting} onClose={closeActions} title={acting?.entry.name}>
        {acting && scope && (
          <>
            {actionError ? (
              <T tone="bad" style={{ paddingHorizontal: space.l, paddingBottom: space.s }}>
                {actionError}
              </T>
            ) : null}
            {writerActive && renameDraft === null && !moving ? (
              <T tone="muted" size={font.caption} style={{ paddingHorizontal: space.l, paddingBottom: space.s }}>
                {t.explorerWriterWarning}
              </T>
            ) : null}
            {moving ? (
              <SheetGroup title={t.explorerMoveTitle}>
                {Object.keys(directories[acting.repoId] ?? {})
                  .sort()
                  .map((folder) => ({ folder, plan: planMove(acting.entry.path, folder) }))
                  .filter(({ plan }) => plan.ok)
                  .map(({ folder, plan }) => (
                    <SheetOption
                      key={folder}
                      icon={Folder}
                      title={folder || t.explorerRootFolder}
                      disabled={acted}
                      onPress={() =>
                        plan.ok &&
                        void change(
                          () =>
                            store.invoke(
                              scope.host,
                              'files.rename',
                              scope.context,
                              acting.repoId,
                              acting.entry.path,
                              plan.destination,
                            ),
                          parentFolder(acting.entry.path),
                          acting.repoId,
                        ).then(() => {
                          const binding = bindingsRef.current.find((entry) => entry.repoId === acting.repoId)
                          if (binding) void loadDirectory(binding, folder)
                        })
                      }
                    />
                  ))}
              </SheetGroup>
            ) : renameDraft === null ? (
              <>
                <SheetGroup>
                  {available.includes('copy-path') && (
                    <SheetOption
                      icon={Copy}
                      title={t.explorerCopyPath}
                      help={fill(
                        t.explorerCopyPathNote,
                        store.computers.find((pc) => pc.id === scope.host)?.name ?? '',
                      )}
                      onPress={() => {
                        void Clipboard.setStringAsync(acting.entry.path)
                        closeActions()
                      }}
                    />
                  )}
                  {available.includes('copy-contents') && (
                    <SheetOption
                      icon={FileText}
                      title={t.explorerCopyContents}
                      disabled={acted}
                      onPress={() => void withContents((text) => Clipboard.setStringAsync(text))}
                    />
                  )}
                  {available.includes('share') && (
                    <SheetOption
                      icon={Share2}
                      title={t.explorerShare}
                      disabled={acted}
                      onPress={() =>
                        void withContents(async (text) => {
                          if (!(await shareDownloadedFile(acting.entry.name, text)))
                            throw new Error(t.explorerShareUnavailable)
                        })
                      }
                    />
                  )}
                </SheetGroup>
                <SheetGroup>
                  {available.includes('duplicate') && (
                    <SheetOption
                      icon={Files}
                      title={t.explorerDuplicate}
                      disabled={acted}
                      onPress={() =>
                        void change(
                          () =>
                            store.invoke(
                              scope.host,
                              'files.copy',
                              scope.context,
                              acting.repoId,
                              acting.entry.path,
                              duplicateName(
                                acting.entry.path,
                                (directories[acting.repoId]?.[parentFolder(acting.entry.path)] ?? []).map(
                                  (entry) => entry.name,
                                ),
                              ),
                            ),
                          parentFolder(acting.entry.path),
                          acting.repoId,
                        )
                      }
                    />
                  )}
                  {available.includes('move') && (
                    <SheetOption icon={FolderInput} title={t.explorerMove} onPress={() => setMoving(true)} />
                  )}
                  {available.includes('rename') && (
                    <SheetOption
                      icon={Pencil}
                      title={t.explorerRename}
                      onPress={() => setRenameDraft(acting.entry.name)}
                    />
                  )}
                </SheetGroup>
                <SheetGroup>
                  {available.includes('delete') && (
                    <SheetOption
                      icon={Trash2}
                      danger
                      title={t.explorerDelete}
                      disabled={acted}
                      onPress={() =>
                        Alert.alert(
                          t.explorerDelete,
                          fill(t.explorerDeleteConfirm, acting.entry.path) +
                            (writerActive ? `\n\n${t.explorerWriterWarning}` : ''),
                          [
                            { text: t.cancel, style: 'cancel' },
                            {
                              text: t.explorerDelete,
                              style: 'destructive',
                              onPress: () =>
                                void change(
                                  () =>
                                    store.invoke(
                                      scope.host,
                                      'files.delete',
                                      scope.context,
                                      acting.repoId,
                                      acting.entry.path,
                                    ),
                                  parentFolder(acting.entry.path),
                                  acting.repoId,
                                ),
                            },
                          ],
                        )
                      }
                    />
                  )}
                </SheetGroup>
              </>
            ) : (
              <>
                <View style={{ paddingHorizontal: space.l, gap: space.m }}>
                  <TextInput
                    autoFocus
                    accessibilityLabel={t.explorerRenameTitle}
                    value={renameDraft}
                    onChangeText={setRenameDraft}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={{
                      color: c.text,
                      fontSize: font.body,
                      minHeight: 48,
                      paddingHorizontal: space.m,
                      borderRadius: radius.m,
                      backgroundColor: c.raised2,
                    }}
                  />
                  <Button
                    title={t.explorerRename}
                    disabled={acted}
                    onPress={() => {
                      const plan = planRename(acting.entry.path, renameDraft)
                      if (!plan.ok) {
                        if (plan.reason === 'invalid') setActionError(t.explorerNameInvalid)
                        else if (plan.reason === 'unchanged') closeActions()
                        return
                      }
                      void change(
                        () =>
                          store.invoke(
                            scope.host,
                            'files.rename',
                            scope.context,
                            acting.repoId,
                            acting.entry.path,
                            plan.destination,
                          ),
                        parentFolder(acting.entry.path),
                        acting.repoId,
                      )
                    }}
                  />
                </View>
              </>
            )}
          </>
        )}
      </Sheet>
      {scope ? (
        <BottomSearch value={query} onChangeText={setQuery} placeholder={t.searchFilePaths} label={t.searchCheckout} />
      ) : null}
    </Screen>
  )
}
