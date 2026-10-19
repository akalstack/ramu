import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronDown, ChevronRight, File, Folder, RefreshCw, GitBranch, ListCollapse } from 'lucide-react-native'
import type { DirEntry, RepositoryBinding } from '@ramu/shared/types'
import {
  explorerKey,
  flattenExplorer,
  projectExplorerContext,
  projectWorkspaces,
  explorerAncestors,
} from '@ramu/shared/workspace/explorer'
import { useStore } from '../runtime/store'
import { useWorkspaces } from '../runtime/useWorkspaces'
import { useT } from '../i18n'
import { font, space, useTheme } from '../theme'
import { Header, HeaderButton, PageFlatList, Screen } from '../components/Screen'
import { Row, T } from '../components/ui'

type ExplorerScope = { host: string; context: string; label?: string }

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
  const list = useRef<import('react-native').FlatList<{ repoId: string; entry: DirEntry; depth: number }>>(null)
  const selected =
    scope && params.computer === scope.host && params.ctx === scope.context && params.repoId && params.path
      ? { repoId: params.repoId, path: params.path }
      : undefined
  const revealed = useRef('')
  const revealKey = selected
    ? JSON.stringify([scope?.host, scope?.context, selected.repoId, selected.path, params.revealId])
    : ''
  useEffect(() => {
    if (selected) setQuery('')
  }, [revealKey])
  const [project, setProject] = useState<(typeof store.projects)[number] | null>(null)
  const catalog = useWorkspaces(project?.computerId ?? '', !!project && !scope)
  const workspaces = project ? projectWorkspaces(project.computerId, project.id, catalog.rows) : []
  const [bindings, setBindings] = useState<RepositoryBinding[]>([])
  const [directories, setDirectories] = useState<Record<string, Record<string, DirEntry[]>>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
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
  const online = scope ? store.isOnline(scope.host) : false
  const scopeIdentity = scope ? JSON.stringify([scope.host, scope.context]) : ''
  const activeScope = useRef(scopeIdentity)
  activeScope.current = scopeIdentity
  const loadDirectory = async (binding: RepositoryBinding, path: string, version = epoch.current) => {
    if (!scope || binding.setupState !== 'ready' || activeScope.current !== scopeIdentity || version !== epoch.current)
      return
    const key = `${version}:${explorerKey(scope.host, scope.context, binding.repoId, path)}`
    if (inFlight.current.has(key)) return
    inFlight.current.add(key)
    try {
      const { entries, truncated } = await store.invoke(scope.host, 'files.browse', scope.context, binding.repoId, path)
      if (version === epoch.current) {
        if (truncated) setError(t.explorerTruncated)
        setDirectories((all) => ({ ...all, [binding.repoId]: { ...all[binding.repoId], [path]: entries } }))
        return entries
      }
    } catch (cause) {
      if (version === epoch.current) setError(String(cause instanceof Error ? cause.message : cause))
    } finally {
      inFlight.current.delete(key)
    }
  }
  useEffect(() => {
    const version = ++epoch.current
    const identity = JSON.stringify([scope?.host, scope?.context])
    if (lastScope.current !== identity || !online) {
      setBindings([])
      setDirectories({})
      setExpanded(new Set())
      setMatches([])
      setQuery('')
    }
    lastScope.current = identity
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
      const off = store.subscribe(scope.host, (channel, payload) => {
        if (channel === 'fs:changed' && bindingsRef.current.some((b) => b.cwd === payload.cwd)) {
          clearTimeout(timer)
          timer = setTimeout(() => reload((value) => value + 1), 300)
        }
      })
      return () => {
        clearTimeout(timer)
        off()
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
          if (alive)
            setMatches(all.filter((entry) => entry.path.toLowerCase().includes(query.toLowerCase())).slice(0, 201))
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
  const rows = useMemo(
    () =>
      query.trim()
        ? matches.slice(0, 200).map((entry) => ({
            repoId: entry.repoId,
            entry: { name: entry.path, path: entry.path, kind: 'file' as const },
            depth: 0,
          }))
        : bindings.flatMap((binding) => flattenExplorer(binding.repoId, directories[binding.repoId] ?? {}, expanded)),
    [bindings, directories, expanded, query, matches],
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
  return (
    <Screen>
      <Header
        title="Explorer"
        subtitle={
          <T size={font.caption} tone="muted">
            {scope
              ? `${store.computers.find((h) => h.id === scope.host)?.name ?? t.hostUnavailable} · ${scope.label ?? (scope.context.startsWith('project:') ? t.currentCheckout : t.threadFiles)}`
              : project
                ? `${project.name} · ${t.chooseCheckout}`
                : t.chooseHostProject}
          </T>
        }
        right={
          scope ? (
            <View style={{ flexDirection: 'row' }}>
              <HeaderButton
                icon={Folder}
                label={t.changeCheckout}
                onPress={() => {
                  setScope(null)
                  setProject(null)
                }}
              />
              <HeaderButton
                icon={ListCollapse}
                label={t.collapseFolders}
                onPress={() => {
                  revealed.current = revealKey
                  setExpanded(new Set())
                }}
              />
              <HeaderButton icon={RefreshCw} label={t.refreshFiles} onPress={() => reload((value) => value + 1)} />
            </View>
          ) : project ? (
            <HeaderButton icon={Folder} label={t.changeCheckout} onPress={() => setProject(null)} />
          ) : undefined
        }
      />
      {!scope ? (
        <PageFlatList
          data={project ? [] : store.projects}
          keyExtractor={(project) => project.id}
          renderItem={({ item }) => (
            <Row onPress={() => setProject(item)}>
              <Folder size={18} color={c.soft} />
              <View>
                <T>{item.name}</T>
                <T tone="muted" size={font.caption}>
                  {store.computers.find((h) => h.id === item.computerId)?.name}
                </T>
              </View>
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
          <TextInput
            accessibilityLabel={t.searchCheckout}
            placeholder={t.searchFilePaths}
            placeholderTextColor={c.muted}
            value={query}
            onChangeText={setQuery}
            style={{ margin: space.m, padding: space.m, color: c.text, backgroundColor: c.fill, borderRadius: 8 }}
          />
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
          {matches.length > 200 ? (
            <T tone="muted" style={{ padding: space.m }}>
              {t.explorerMoreMatches}
            </T>
          ) : null}
          {loading ? <ActivityIndicator color={c.accent} /> : null}
          <PageFlatList
            ref={list}
            onScrollToIndexFailed={(info) =>
              list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false })
            }
            data={rows}
            keyExtractor={(row) => explorerKey(scope.host, scope.context, row.repoId, row.entry.path)}
            contentInsetAdjustmentBehavior="automatic"
            ListHeaderComponent={
              <View style={{ paddingHorizontal: space.m, gap: space.s }}>
                {bindings.map((binding) => (
                  <View key={binding.repoId}>
                    <T weight="500">
                      {binding.repoName}
                      {binding.taskBranch ? ` · ${binding.taskBranch}` : ''}
                    </T>
                    <T tone="muted" size={font.caption}>
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
            renderItem={({ item: row }) => {
              const binding = bindings.find((b) => b.repoId === row.repoId)!
              const key = `${row.repoId}:${row.entry.path}`
              const isOpen = expanded.has(key)
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${binding?.repoName ?? row.repoId}/${row.entry.path}`}
                  accessibilityState={
                    row.entry.kind === 'dir'
                      ? { expanded: isOpen }
                      : { selected: selected?.repoId === row.repoId && selected.path === row.entry.path }
                  }
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
                  {row.entry.kind === 'dir' ? (
                    isOpen ? (
                      <ChevronDown size={15} color={c.soft} />
                    ) : (
                      <ChevronRight size={15} color={c.soft} />
                    )
                  ) : (
                    <File size={15} color={c.soft} />
                  )}
                  <View style={{ flex: 1 }}>
                    <T numberOfLines={2}>{row.entry.name}</T>
                    {bindings.length > 1 || query ? (
                      <T size={font.caption} tone="muted">
                        {binding?.repoName}
                      </T>
                    ) : null}
                  </View>
                </Pressable>
              )
            }}
            ListEmptyComponent={
              !loading && online ? (
                <T tone="muted" style={{ padding: space.l }}>
                  {query ? t.explorerNoMatches : t.explorerNoFiles}
                </T>
              ) : null
            }
          />
        </>
      )}
    </Screen>
  )
}
