import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView as HScroll, TextInput, View, type ScrollViewInstance } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  Folder,
  FolderGit2,
  FolderPlus,
  HardDrive,
  House,
  Lock,
  Monitor,
  PencilLine,
  Search,
  X,
} from 'lucide-react-native'
import type { ForgeRepositorySummary } from '@ramu/shared/types'
import {
  cloneFolderName,
  cloneProgressText,
  cloneStartFolder,
  folderCrumbs,
  folderName,
  placeLabel,
  placesFromRoots,
  typedFolderPath,
  type CloneStep,
  type HostFolderListing,
  type HostPlace,
} from '@ramu/shared/workspace/hostFolders'
import { goBackOrHome } from '../runtime/navigation'
import { finishFolderPick } from '../runtime/folderPick'
import { childPath, repositoryCloneUrl } from '../runtime/cloneRepository'
import { Header, Screen, GlassButton, PageScrollView as ScrollView } from '../components/Screen'
import { ReadableColumn } from '../components/ReadableColumn'
import { useKeyboardInset } from '../components/Keyboard'
import { Button, Chip, Divider, IconButton, ROW_INSET, Row, SectionLabel, T, tap } from '../components/ui'
import { useStore } from '../runtime/store'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { PageLoader } from '../components/PageLoader'

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const PLACE_ICONS = { home: House, computer: Monitor, drive: HardDrive, project: FolderGit2 } as const

/**
 * Add a project from a folder on the selected host: start from its home, root, drives or project folders, walk its
 * folders (Git repositories are marked) or type a path, make a new one, or
 * clone a repository here, then add the folder in view with the one button at the bottom. Opened with `purpose=parent`
 * it chooses where a new project's folder goes instead (from `start`, on host `computer`), answering `pickFolder`.
 * Opened with `clone=owner/repo` (a pull request's repository no project holds) it opens where the host's projects sit
 * and the button clones that repository into the folder in view.
 */
export default function HostFolders() {
  const say = useSay()
  const store = useStore()
  const router = useRouter()
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboardInset()
  const params = useLocalSearchParams<{
    clone?: string
    forge?: string
    purpose?: string
    start?: string
    computer?: string
  }>()
  const choosingParent = params.purpose === 'parent'
  const computerId = params.computer ?? store.selected
  const host = store.computers.find((x) => x.id === computerId)
  const wanted = choosingParent ? undefined : params.clone
  const cloneName = wanted ? cloneFolderName(wanted) : ''
  // Leaving without choosing answers the sheet that asked with no folder.
  useEffect(() => () => void (choosingParent && finishFolderPick(null)), [choosingParent])
  const [places, setPlaces] = useState<HostPlace[] | null>(null)
  const [listing, setListing] = useState<HostFolderListing | null>(null)
  const [error, setError] = useState<{ text: string; retry: () => void } | null>(null)
  // The folder being opened, shown on its row until the host answers.
  const [opening, setOpening] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [searching, setSearching] = useState(false)
  // The new folder's name while its row is open; null while it is closed.
  const [naming, setNaming] = useState<string | null>(null)
  // A path being typed; null while its row is closed.
  const [typing, setTyping] = useState<string | null>(null)
  const crumbBar = useRef<ScrollViewInstance>(null)
  const browsing = useRef(0)
  const cloneRun = useClone(computerId)
  // The repository's clone address is looked up once, while a folder is chosen, so Clone here starts at once.
  const cloneUrl = useRef<Promise<string> | null>(null)
  useEffect(() => {
    if (!wanted) return
    cloneUrl.current = store
      .invoke(computerId, 'forge.searchRepositories', wanted)
      .catch(() => [])
      .then((found) => repositoryCloneUrl(wanted, found, params.forge))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `store` changes on every update; the address follows the host and repository only
  }, [computerId, wanted, params.forge])
  useEffect(() => () => void browsing.current++, [])

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (e) {
      setError({ text: errorText(e), retry: () => void run(work) })
    } finally {
      setBusy(false)
    }
  }
  /** Opens a folder; only the latest one tapped is shown, so a slow earlier answer never replaces it. */
  const browse = (path: string) => {
    const mine = ++browsing.current
    setOpening(path)
    setError(null)
    store.invoke(computerId, 'folders.list', path).then(
      (next) => {
        if (mine !== browsing.current) return
        setListing(next)
        setNaming(null)
        setTyping(null)
        setOpening(null)
      },
      (e: unknown) => {
        if (mine !== browsing.current) return
        setOpening(null)
        setError({ text: errorText(e), retry: () => browse(path) })
      },
    )
  }
  const open = (path: string) => {
    tap()
    browse(path)
  }
  const showLocations = () => {
    browsing.current++
    setOpening(null)
    setError(null)
    setListing(null)
  }
  const loadPlaces = () => {
    setError(null)
    setPlaces(null)
    // A host too old to list places still has its browse roots.
    store
      .invoke(computerId, 'folders.places')
      .catch(() => store.invoke(computerId, 'folders.roots').then(placesFromRoots))
      .then(
        (found) => {
          setPlaces(found)
          const usual = found.filter((place) => place.kind === 'home' || place.kind === 'project')
          // Where the project would go now opens first; a clone opens where the host's projects sit; one place to
          // browse needs no choosing.
          const first =
            (choosingParent && params.start) ||
            (wanted ? cloneStartFolder(usual.map((place) => place.path)) : undefined) ||
            (found.length === 1 ? found[0]?.path : undefined)
          if (first) browse(first)
        },
        (e: unknown) => setError({ text: errorText(e), retry: loadPlaces }),
      )
  }
  useEffect(() => {
    loadPlaces()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [computerId] by design; the values it reads beyond these are current as of that run
  }, [computerId])
  const addProject = (path: string) =>
    run(async () => {
      await store.invoke(computerId, 'folders.addProject', path)
      await store.refresh(computerId)
      goBackOrHome(router)
    })
  const createFolder = () => {
    if (!listing || !naming?.trim()) return
    void run(async () => {
      const path = await store.invoke(computerId, 'folders.create', listing.path, naming.trim())
      setNaming(null)
      browse(path)
    })
  }
  const cloneHere = (parent: string) => {
    if (!wanted || !cloneName || cloneRun.running) return
    tap()
    void run(async () => {
      const url = await (cloneUrl.current ?? repositoryCloneUrl(wanted, [], params.forge))
      const path = await cloneRun.run(parent, cloneName, url)
      await store.invoke(computerId, 'folders.addProject', path)
      await store.refresh(computerId)
      goBackOrHome(router)
    })
  }
  const crumbs = listing ? folderCrumbs(listing.path, places?.map((place) => place.path) ?? []) : []
  const here = listing ? folderName(listing.path) : ''
  // The repository may already be here; adding that checkout beats cloning it again.
  const existing = wanted ? listing?.folders.find((folder) => folder.name === cloneName && folder.repo) : undefined
  const cloning = !!cloneRun.running
  const working = busy || cloning
  // A filesystem root or system folder can be walked through, and a new project can go in it, but it is no project.
  const refused = !choosingParent && !wanted && !!listing?.system
  const goTo = () => {
    const path = typedFolderPath(typing ?? '')
    if (path) open(path)
  }
  // The whole path typed or pasted, from the host's places or from the folder in view, which it starts from.
  const pathRow =
    typing === null ? (
      <Row onPress={() => setTyping(listing?.path ?? '')} disabled={working}>
        <PencilLine size={16} color={c.accent} />
        <T tone="accent" weight="500" style={{ flex: 1 }}>
          {say('Type a path')}
        </T>
      </Row>
    ) : (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.m,
          paddingLeft: space.l,
          paddingRight: space.s,
          minHeight: 48,
        }}
      >
        <PencilLine size={16} color={c.accent} />
        <TextInput
          autoFocus
          value={typing}
          onChangeText={setTyping}
          onSubmitEditing={goTo}
          returnKeyType="go"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder={say('Folder path on the host, like ~/code or /Volumes/Drive')}
          placeholderTextColor={c.placeholder}
          accessibilityLabel={say('Folder path')}
          style={{ flex: 1, color: c.text, fontSize: font.body, paddingVertical: space.s }}
        />
        <IconButton
          icon={ChevronRight}
          label={say('Go')}
          size={34}
          tone="accent"
          disabled={!!opening || !typedFolderPath(typing)}
          onPress={goTo}
        />
        <IconButton icon={X} label={say('Cancel')} size={34} tone="muted" onPress={() => setTyping(null)} />
      </View>
    )

  if (searching && listing)
    return (
      <Screen bg="canvas">
        <Header modal title={say('Clone a repository')} subtitle={host?.name} />
        <CloneRepository
          computerId={computerId}
          parent={listing.path}
          onBack={() => setSearching(false)}
          onCloned={(path) => void addProject(path)}
        />
      </Screen>
    )

  return (
    <Screen bg="canvas">
      <Header
        modal
        title={
          wanted ? say('Clone {0}', { 0: wanted }) : choosingParent ? say('Choose where to put it') : say('Add project')
        }
        subtitle={host?.name}
      />
      {wanted ? (
        <T size={font.caption} tone="muted" style={{ paddingHorizontal: space.l, paddingTop: space.s }}>
          {say('Choose the folder to clone it into.')}
        </T>
      ) : null}
      {/* Where you are, one tap per step back up; Locations returns to the host's starting places. */}
      {listing ? (
        <HScroll
          ref={crumbBar}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          onContentSizeChange={() => crumbBar.current?.scrollToEnd({ animated: false })}
          contentContainerStyle={{ paddingHorizontal: space.l, paddingVertical: space.s, gap: 4, alignItems: 'center' }}
        >
          {(places?.length ?? 0) > 1 ? (
            <>
              <Chip small icon={HardDrive} label={say('Locations')} onPress={showLocations} />
              <ChevronRight size={12} color={c.placeholder} />
            </>
          ) : null}
          {crumbs.map((crumb, index) => (
            <View key={crumb.path} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {index ? <ChevronRight size={12} color={c.placeholder} /> : null}
              <Chip
                small
                label={crumb.name}
                selected={index === crumbs.length - 1}
                maxLabelWidth={160}
                onPress={() => {
                  if (index < crumbs.length - 1) open(crumb.path)
                }}
              />
            </View>
          ))}
          {opening ? <ActivityIndicator size="small" color={c.muted} style={{ marginLeft: space.xs }} /> : null}
        </HScroll>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: space.xl }}
      >
        {error ? (
          <View
            accessibilityLiveRegion="polite"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s,
              marginHorizontal: space.l,
              marginVertical: space.s,
              paddingLeft: space.m,
              paddingRight: space.xs,
              paddingVertical: space.xs,
              borderRadius: radius.m,
              backgroundColor: c.badWash,
            }}
          >
            <CircleAlert size={15} color={c.bad} />
            <T tone="bad" size={font.control} selectable style={{ flex: 1, paddingVertical: space.xs }}>
              {error.text}
            </T>
            <Button kind="ghost" title={say('Try again')} disabled={working} onPress={error.retry} />
          </View>
        ) : null}
        {!listing ? (
          places === null || (opening && !places.some((place) => place.path === opening)) ? (
            error ? null : (
              <View style={{ alignItems: 'center', gap: space.s, margin: space.xl }}>
                <PageLoader color={c.accent} />
                <T size={font.caption} tone="muted">
                  {say('Loading folders…')}
                </T>
              </View>
            )
          ) : (
            <>
              {pathRow}
              <SectionLabel>{say('Locations')}</SectionLabel>
              {places.map((place, index) => {
                const Icon = PLACE_ICONS[place.kind]
                const firstProject = place.kind === 'project' && places[index - 1]?.kind !== 'project'
                return (
                  <View key={place.path}>
                    {firstProject ? (
                      <SectionLabel>{say('Projects')}</SectionLabel>
                    ) : index ? (
                      <Divider inset={ROW_INSET} />
                    ) : null}
                    <Row onPress={() => open(place.path)} accessibilityState={{ busy: opening === place.path }}>
                      <Icon size={16} color={c.soft} />
                      <View style={{ flex: 1 }}>
                        <T numberOfLines={1}>{placeLabel(place, say)}</T>
                        <T size={font.caption} tone="muted" numberOfLines={1} ellipsizeMode="head">
                          {place.path}
                        </T>
                      </View>
                      {opening === place.path ? (
                        <ActivityIndicator size="small" color={c.accent} />
                      ) : (
                        <ChevronRight size={15} color={c.muted} />
                      )}
                    </Row>
                  </View>
                )
              })}
            </>
          )
        ) : (
          <>
            {/* Making room for a project comes first: a new folder named in place, or a repository cloned here. */}
            {naming === null ? (
              <Row onPress={() => setNaming('')} disabled={working}>
                <FolderPlus size={16} color={c.accent} />
                <T tone="accent" weight="500" style={{ flex: 1 }}>
                  {say('New folder')}
                </T>
              </Row>
            ) : (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.m,
                  paddingLeft: space.l,
                  paddingRight: space.s,
                  minHeight: 48,
                }}
              >
                <FolderPlus size={16} color={c.accent} />
                <TextInput
                  autoFocus
                  value={naming}
                  onChangeText={setNaming}
                  onSubmitEditing={createFolder}
                  returnKeyType="done"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={say('Folder name')}
                  placeholderTextColor={c.placeholder}
                  accessibilityLabel={say('Folder name')}
                  style={{ flex: 1, color: c.text, fontSize: font.body, paddingVertical: space.s }}
                />
                <IconButton
                  icon={Check}
                  label={say('Create folder')}
                  size={34}
                  tone="accent"
                  disabled={busy || !naming.trim()}
                  onPress={createFolder}
                />
                <IconButton icon={X} label={say('Cancel')} size={34} tone="muted" onPress={() => setNaming(null)} />
              </View>
            )}
            {/* A repository asked for by name clones with the button below, with no search for it. */}
            {choosingParent || wanted ? null : (
              <>
                <Divider inset={ROW_INSET} />
                <Row onPress={() => setSearching(true)} disabled={working}>
                  <Download size={16} color={c.accent} />
                  <T tone="accent" weight="500" style={{ flex: 1 }}>
                    {say('Clone a repository here')}
                  </T>
                </Row>
              </>
            )}
            <Divider inset={ROW_INSET} />
            {pathRow}
            <SectionLabel>{here}</SectionLabel>
            {listing.folders.map((folder, index) => (
              <View key={folder.path}>
                {index ? <Divider inset={ROW_INSET} /> : null}
                <Row
                  onPress={() => open(folder.path)}
                  disabled={cloning}
                  accessibilityState={{ busy: opening === folder.path }}
                  accessibilityLabel={folder.repo ? `${folder.name}, ${say('Git repository')}` : folder.name}
                  style={opening === folder.path ? { backgroundColor: c.pressed } : undefined}
                >
                  {folder.repo ? <FolderGit2 size={16} color={c.accent} /> : <Folder size={16} color={c.soft} />}
                  <T style={{ flex: 1 }} numberOfLines={1}>
                    {folder.name}
                  </T>
                  {opening === folder.path ? (
                    <ActivityIndicator size="small" color={c.accent} />
                  ) : (
                    <ChevronRight size={15} color={c.muted} />
                  )}
                </Row>
              </View>
            ))}
            {!listing.folders.length ? (
              <T tone="muted" style={{ paddingHorizontal: space.l, paddingVertical: space.m }}>
                {say('No folders here')}
              </T>
            ) : null}
          </>
        )}
      </ScrollView>
      {/* The one thing this screen is for, always in reach: add, choose or clone into the folder in view. */}
      {listing ? (
        <View
          style={{
            borderTopWidth: 0.5,
            borderTopColor: c.lineStrong,
            paddingTop: space.s,
            paddingBottom: keyboard ? keyboard + space.s : Math.max(insets.bottom, space.s),
          }}
        >
          <ReadableColumn style={{ paddingHorizontal: space.l, gap: 6 }}>
            {cloning ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 48 }}>
                <ActivityIndicator size="small" color={c.accent} />
                <T tone="accent" weight="500" numberOfLines={1} style={{ flex: 1 }} accessibilityLiveRegion="polite">
                  {cloneProgressText(cloneRun.progress, say)}
                </T>
                <Button kind="secondary" title={say('Cancel clone')} onPress={cloneRun.cancel} />
              </View>
            ) : wanted && !existing ? (
              <GlassButton
                primary
                icon={Download}
                title={say('Clone here')}
                disabled={working || !!opening || !cloneName}
                onPress={() => cloneHere(listing.path)}
              />
            ) : (
              <GlassButton
                primary
                icon={existing || listing.repo ? FolderGit2 : Folder}
                title={
                  existing
                    ? say('Add {0}', { 0: existing.name })
                    : choosingParent
                      ? say('Put it here')
                      : say('Add {0}', { 0: here })
                }
                disabled={working || !!opening || (refused && !existing)}
                onPress={() => {
                  if (existing) return void addProject(existing.path)
                  if (!choosingParent) return void addProject(listing.path)
                  finishFolderPick(listing.path)
                  goBackOrHome(router)
                }}
              />
            )}
            <T
              size={font.caption}
              tone="muted"
              numberOfLines={refused ? 2 : 1}
              ellipsizeMode={refused ? 'tail' : 'head'}
              style={{ textAlign: 'center' }}
            >
              {existing
                ? say('Already cloned here. Add it as a project.')
                : refused
                  ? say('This is a system folder. Open a folder inside it to add as a project.')
                  : wanted
                    ? say('Clones into {0}', { 0: childPath(listing.path, cloneName) })
                    : listing.path}
            </T>
          </ReadableColumn>
        </View>
      ) : null}
    </Screen>
  )
}

/** One clone at a time on the host, with its progress as Git reports it and a way to cancel it. */
function useClone(computerId: string) {
  const store = useStore()
  // The URL being cloned and its progress; the id the host knows the clone by, to read progress and cancel it.
  const [running, setRunning] = useState<string | null>(null)
  const [progress, setProgress] = useState<CloneStep | null>(null)
  const active = useRef<string | null>(null)
  useEffect(() => () => void (active.current = null), [])
  const run = async (parent: string, name: string, url: string) => {
    const id = `clone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    active.current = id
    setRunning(url)
    setProgress(null)
    const timer = setInterval(
      () =>
        void store.invoke(computerId, 'folders.cloneProgress', id).then(
          (next) => active.current === id && setProgress(next && { phase: next.phase, percent: next.percent }),
          () => {},
        ),
      800,
    )
    try {
      return await store.invoke(computerId, 'folders.clone', parent, name, url, id)
    } finally {
      clearInterval(timer)
      if (active.current === id) {
        active.current = null
        setRunning(null)
        setProgress(null)
      }
    }
  }
  const cancel = () => {
    const id = active.current
    if (id) void store.invoke(computerId, 'folders.cancelClone', id).catch(() => {})
  }
  return { running, progress, run, cancel }
}

/**
 * Find a repository through the host's GitHub account, or paste a Git URL, and clone it into `parent`, named after the
 * repository. The host clones with its own credentials; the new folder is then added as the project.
 */
function CloneRepository({
  computerId,
  parent,
  onBack,
  onCloned,
}: {
  computerId: string
  parent: string
  onBack: () => void
  onCloned: (path: string) => void
}) {
  const say = useSay()
  const store = useStore()
  const { c } = useTheme()
  const [query, setQuery] = useState('')
  const [url, setUrl] = useState('')
  const [results, setResults] = useState<ForgeRepositorySummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const { running: cloning, progress, run, cancel } = useClone(computerId)
  const request = useRef(0)
  useEffect(() => {
    // Debounced; a slow older search never replaces a newer one.
    const mine = ++request.current
    setSearching(true)
    const timer = setTimeout(
      () =>
        store.invoke(computerId, 'forge.searchRepositories', query.trim()).then(
          (found) => {
            if (mine !== request.current) return
            setResults(found)
            setError('')
            setSearching(false)
          },
          (reason: unknown) => {
            if (mine !== request.current) return
            setResults([])
            setError(errorText(reason))
            setSearching(false)
          },
        ),
      query ? 350 : 0,
    )
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `store` changes on every update; the search follows the query and host only
  }, [computerId, query])
  const clone = async (cloneUrl: string) => {
    const name = cloneFolderName(cloneUrl)
    if (!name || cloning) return
    tap()
    setError('')
    try {
      onCloned(await run(parent, name, cloneUrl))
    } catch (reason) {
      setError(errorText(reason))
    }
  }
  const status = cloneProgressText(progress, say)
  const field = {
    flex: 1,
    color: c.text,
    fontSize: font.body,
    paddingVertical: space.s,
  } as const
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingBottom: space.xl * 2 }}
    >
      <Row onPress={onBack} disabled={!!cloning} style={{ minHeight: 40, paddingVertical: space.xs }}>
        <ChevronLeft size={16} color={c.soft} />
        <T tone="soft" style={{ flex: 1 }}>
          {say('Back to folders')}
        </T>
      </Row>
      <T
        size={font.caption}
        tone="muted"
        numberOfLines={1}
        ellipsizeMode="head"
        style={{ paddingHorizontal: space.l, paddingBottom: space.s }}
      >
        {say('Clone into {0}', { 0: parent })}
      </T>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s,
          marginHorizontal: space.l,
          paddingHorizontal: space.m,
          borderRadius: radius.m,
          backgroundColor: c.fill,
        }}
      >
        <Search size={15} color={c.muted} />
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={say('Search GitHub repositories')}
          placeholderTextColor={c.placeholder}
          accessibilityLabel={say('Search GitHub repositories')}
          style={field}
        />
        {searching ? <ActivityIndicator size="small" color={c.muted} /> : null}
      </View>
      {error ? (
        <T tone="bad" size={font.control} style={{ paddingHorizontal: space.l, paddingTop: space.s }}>
          {error}
        </T>
      ) : null}
      <View style={{ paddingTop: space.s }}>
        {results?.map((repository, index) => {
          const mine = cloning === repository.cloneUrl
          return (
            <View key={repository.fullName}>
              {index ? <Divider inset={space.l} /> : null}
              <Row
                disabled={!!cloning}
                onPress={() => void clone(repository.cloneUrl)}
                accessibilityLabel={[
                  repository.fullName,
                  repository.private ? say('Private repository') : '',
                  mine ? status : '',
                ]
                  .filter(Boolean)
                  .join(', ')}
                style={{ alignItems: 'flex-start', opacity: cloning && !mine ? 0.5 : 1 }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <T weight="500" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {repository.fullName}
                    </T>
                    {repository.private ? <Lock size={12} color={c.muted} /> : null}
                  </View>
                  {mine ? (
                    <T size={font.caption} tone="accent">
                      {status}
                    </T>
                  ) : repository.description ? (
                    <T size={font.caption} tone="muted" numberOfLines={2}>
                      {repository.description}
                    </T>
                  ) : null}
                </View>
                {mine ? <ActivityIndicator size="small" color={c.accent} /> : <Download size={15} color={c.muted} />}
              </Row>
            </View>
          )
        })}
        {results && !results.length && !searching && !error ? (
          <T tone="muted" style={{ paddingHorizontal: space.l, paddingVertical: space.m }}>
            {say('No repositories found')}
          </T>
        ) : null}
      </View>
      <SectionLabel>{say('Or paste a Git URL')}</SectionLabel>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.l }}>
        <View style={{ flex: 1, paddingHorizontal: space.m, borderRadius: radius.m, backgroundColor: c.fill }}>
          <TextInput
            value={url}
            onChangeText={setUrl}
            onSubmitEditing={() => void clone(url.trim())}
            returnKeyType="go"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://github.com/owner/repo.git"
            placeholderTextColor={c.placeholder}
            accessibilityLabel={say('Or paste a Git URL')}
            style={field}
          />
        </View>
        <Button
          title={cloning === url.trim() && cloning ? status : say('Clone')}
          kind="secondary"
          disabled={!!cloning || !cloneFolderName(url)}
          onPress={() => void clone(url.trim())}
        />
      </View>
      {cloning ? (
        <View style={{ paddingHorizontal: space.l, paddingTop: space.m }}>
          <Button title={say('Cancel clone')} kind="ghost" onPress={cancel} />
        </View>
      ) : null}
    </ScrollView>
  )
}
