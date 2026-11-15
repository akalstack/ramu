import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView as HScroll, TextInput, View, type ScrollViewInstance } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Folder,
  FolderGit2,
  FolderPlus,
  HardDrive,
  Lock,
  Search,
  X,
} from 'lucide-react-native'
import type { ForgeRepositorySummary } from '@ramu/shared/types'
import {
  cloneFolderName,
  cloneProgressText,
  folderCrumbs,
  folderName,
  type CloneStep,
  type HostFolderListing,
} from '@ramu/shared/workspace/hostFolders'
import { goBackOrHome } from '../runtime/navigation'
import { finishFolderPick } from '../runtime/folderPick'
import { Header, Screen, GlassButton, PageScrollView as ScrollView } from '../components/Screen'
import { useKeyboardInset } from '../components/Keyboard'
import { Button, Chip, Divider, IconButton, ROW_INSET, Row, SectionLabel, T, tap } from '../components/ui'
import { useStore } from '../runtime/store'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { PageLoader } from '../components/PageLoader'

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Add a project from a folder on the selected host: walk its folders (Git repositories are marked), make a new one, or
 * clone a repository here, then add the folder in view with the one button at the bottom. Opened with `purpose=parent`
 * it chooses where a new project's folder goes instead (from `start`, on host `computer`), answering `pickFolder`.
 */
export default function HostFolders() {
  const say = useSay()
  const store = useStore()
  const router = useRouter()
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboardInset()
  const params = useLocalSearchParams<{ clone?: string; purpose?: string; start?: string; computer?: string }>()
  const choosingParent = params.purpose === 'parent'
  const computerId = params.computer ?? store.selected
  const host = store.computers.find((x) => x.id === computerId)
  // Opened from a pull request in a repository no project holds: that repository (`owner/repo`) is the one to clone.
  const wanted = choosingParent ? undefined : params.clone
  // Leaving without choosing answers the sheet that asked with no folder.
  useEffect(() => () => void (choosingParent && finishFolderPick(null)), [choosingParent])
  const [roots, setRoots] = useState<string[]>([])
  const [listing, setListing] = useState<HostFolderListing | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cloning, setCloning] = useState(false)
  // The new folder's name while its row is open; null while it is closed.
  const [naming, setNaming] = useState<string | null>(null)
  const crumbBar = useRef<ScrollViewInstance>(null)
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await work()
      setError('')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const browse = (path: string) =>
    run(async () => {
      setListing(await store.invoke(computerId, 'folders.list', path))
      setNaming(null)
    })
  useEffect(() => {
    void run(async () => {
      const found = await store.invoke(computerId, 'folders.roots')
      setRoots(found)
      // Where the project would go now opens first; one place to browse needs no choosing.
      const first = (choosingParent && params.start) || (found.length === 1 ? found[0]! : null)
      if (first) setListing(await store.invoke(computerId, 'folders.list', first))
    })
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
      setListing(await store.invoke(computerId, 'folders.list', path))
      setNaming(null)
    })
  }
  const crumbs = listing ? folderCrumbs(listing.path, roots) : []
  const here = listing ? folderName(listing.path) : ''

  if (cloning && listing)
    return (
      <Screen bg="canvas">
        <Header modal title={say('Clone a repository')} subtitle={host?.name} />
        <CloneRepository
          computerId={computerId}
          parent={listing.path}
          initialQuery={wanted}
          onBack={() => setCloning(false)}
          onCloned={(path) => void addProject(path)}
        />
      </Screen>
    )

  return (
    <Screen bg="canvas">
      <Header modal title={choosingParent ? say('Choose where to put it') : say('Add project')} subtitle={host?.name} />
      {wanted ? (
        <T size={font.caption} tone="muted" style={{ paddingHorizontal: space.l, paddingTop: space.s }}>
          {say('Open the folder to clone {0} into, then choose Clone a repository here.', { 0: wanted })}
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
          {roots.length > 1 ? (
            <>
              <Chip small icon={HardDrive} label={say('Locations')} onPress={() => setListing(null)} />
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
                  if (index < crumbs.length - 1) void browse(crumb.path)
                }}
              />
            </View>
          ))}
        </HScroll>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: space.xl }}
      >
        {error ? (
          <T tone="bad" size={font.control} style={{ paddingHorizontal: space.l, paddingVertical: space.s }}>
            {error}
          </T>
        ) : null}
        {!listing ? (
          <>
            <SectionLabel>{say('Locations')}</SectionLabel>
            {roots.map((root, index) => (
              <View key={root}>
                {index ? <Divider inset={ROW_INSET} /> : null}
                <Row onPress={() => void browse(root)}>
                  <HardDrive size={16} color={c.soft} />
                  <View style={{ flex: 1 }}>
                    <T numberOfLines={1}>{folderName(root)}</T>
                    <T size={font.caption} tone="muted" numberOfLines={1} ellipsizeMode="head">
                      {root}
                    </T>
                  </View>
                  <ChevronRight size={15} color={c.muted} />
                </Row>
              </View>
            ))}
            {!roots.length && busy ? <PageLoader style={{ margin: space.xl }} color={c.accent} /> : null}
          </>
        ) : (
          <>
            {/* Making room for a project comes first: a new folder named in place, or a repository cloned here. */}
            {naming === null ? (
              <Row onPress={() => setNaming('')} disabled={busy}>
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
            {choosingParent ? null : (
              <>
                <Divider inset={ROW_INSET} />
                <Row onPress={() => setCloning(true)} disabled={busy}>
                  <Download size={16} color={c.accent} />
                  <T tone="accent" weight="500" style={{ flex: 1 }}>
                    {say('Clone a repository here')}
                  </T>
                </Row>
              </>
            )}
            <SectionLabel>{here}</SectionLabel>
            {listing.folders.map((folder, index) => (
              <View key={folder.path}>
                {index ? <Divider inset={ROW_INSET} /> : null}
                <Row
                  onPress={() => void browse(folder.path)}
                  accessibilityLabel={folder.repo ? `${folder.name}, ${say('Git repository')}` : folder.name}
                >
                  {folder.repo ? <FolderGit2 size={16} color={c.accent} /> : <Folder size={16} color={c.soft} />}
                  <T style={{ flex: 1 }} numberOfLines={1}>
                    {folder.name}
                  </T>
                  <ChevronRight size={15} color={c.muted} />
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
      {/* The one thing this screen is for, always in reach: add the folder in view. */}
      {listing ? (
        <View
          style={{
            borderTopWidth: 0.5,
            borderTopColor: c.lineStrong,
            paddingHorizontal: space.l,
            paddingTop: space.s,
            paddingBottom: keyboard ? keyboard + space.s : Math.max(insets.bottom, space.s),
            gap: 6,
          }}
        >
          <GlassButton
            primary
            icon={listing.repo ? FolderGit2 : Folder}
            title={choosingParent ? say('Put it here') : say('Add {0}', { 0: here })}
            disabled={busy}
            onPress={() => {
              if (!choosingParent) return void addProject(listing.path)
              finishFolderPick(listing.path)
              goBackOrHome(router)
            }}
          />
          <T size={font.caption} tone="muted" numberOfLines={1} ellipsizeMode="head" style={{ textAlign: 'center' }}>
            {listing.path}
          </T>
        </View>
      ) : null}
    </Screen>
  )
}

/**
 * Find a repository through the host's GitHub account, or paste a Git URL, and clone it into `parent`, named after the
 * repository. The host clones with its own credentials; the new folder is then added as the project.
 */
function CloneRepository({
  computerId,
  parent,
  initialQuery,
  onBack,
  onCloned,
}: {
  computerId: string
  parent: string
  initialQuery?: string
  onBack: () => void
  onCloned: (path: string) => void
}) {
  const say = useSay()
  const store = useStore()
  const { c } = useTheme()
  const [query, setQuery] = useState(initialQuery ?? '')
  const [url, setUrl] = useState('')
  const [results, setResults] = useState<ForgeRepositorySummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  // The URL being cloned, its progress, and the id the host knows the clone by (to read progress and cancel it).
  const [cloning, setCloning] = useState<string | null>(null)
  const [progress, setProgress] = useState<CloneStep | null>(null)
  const active = useRef<string | null>(null)
  const request = useRef(0)
  useEffect(() => () => void (active.current = null), [])
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
    const id = `clone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    active.current = id
    setCloning(cloneUrl)
    setProgress(null)
    setError('')
    const timer = setInterval(
      () =>
        void store.invoke(computerId, 'folders.cloneProgress', id).then(
          (next) => active.current === id && setProgress(next && { phase: next.phase, percent: next.percent }),
          () => {},
        ),
      800,
    )
    try {
      onCloned(await store.invoke(computerId, 'folders.clone', parent, name, cloneUrl, id))
    } catch (reason) {
      if (active.current === id) setError(errorText(reason))
    } finally {
      clearInterval(timer)
      if (active.current === id) {
        active.current = null
        setCloning(null)
        setProgress(null)
      }
    }
  }
  const cancel = () => {
    const id = active.current
    if (id) void store.invoke(computerId, 'folders.cancelClone', id).catch(() => {})
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
