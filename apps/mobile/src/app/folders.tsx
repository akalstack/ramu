import { BottomSearch } from '../components/BottomSearch'
import { goBackOrHome } from '../runtime/navigation'
import { useEffect, useRef, useState } from 'react'
import { TextInput } from 'react-native'
import { useRouter } from 'expo-router'
import { Folder, ChevronLeft } from 'lucide-react-native'
import { Header, Screen, GlassButton, PageScrollView as ScrollView } from '../components/Screen'
import { Row, T } from '../components/ui'
import { useStore } from '../runtime/store'
import { font, space, useTheme } from '../theme'
import { useT } from '../i18n'
import type { ForgeRepositorySummary } from '@ramu/shared/types'
export default function HostFolders() {
  const store = useStore(),
    router = useRouter(),
    { c } = useTheme(),
    t = useT()
  const computerId = store.selected
  const [roots, setRoots] = useState<string[]>([])
  const [listing, setListing] = useState<{
    path: string
    parent: string | null
    folders: { name: string; path: string }[]
  }>()
  const [name, setName] = useState(''),
    [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(''),
    [found, setFound] = useState<ForgeRepositorySummary[] | null>(null),
    [cloneProgress, setCloneProgress] = useState<string | null>(null),
    [cancellable, setCancellable] = useState(false)
  const activeClone = useRef<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const browse = (path: string) => run(async () => setListing(await store.invoke(computerId, 'folders.list', path)))
  useEffect(() => {
    void run(async () => setRoots(await store.invoke(computerId, 'folders.roots')))
  }, [computerId])
  return (
    <Screen bg="canvas">
      <Header modal title="Host folders" subtitle={store.computers.find((c) => c.id === computerId)?.name} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.l, gap: space.m }}
      >
        {error ? <T tone="bad">{error}</T> : null}
        <T tone="muted" mono>
          {listing?.path ?? 'Choose a browse root on the host'}
        </T>
        {listing?.parent ? (
          <Row onPress={() => void browse(listing.parent!)}>
            <ChevronLeft color={c.soft} size={18} />
            <T>Parent folder</T>
          </Row>
        ) : null}
        {(listing?.folders ?? roots.map((path) => ({ name: path, path }))).map((folder) => (
          <Row key={folder.path} onPress={() => void browse(folder.path)}>
            <Folder size={18} color={c.soft} />
            <T style={{ flex: 1 }}>{folder.name}</T>
          </Row>
        ))}
        {listing ? (
          <>
            <GlassButton
              title="Add this folder as a project"
              primary
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  await store.invoke(computerId, 'folders.addProject', listing.path)
                  await store.refresh(computerId)
                  goBackOrHome(router)
                })
              }
            />
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="New folder / clone destination name"
              placeholderTextColor={c.muted}
              style={{ padding: space.m, backgroundColor: c.fill, color: c.text, fontSize: font.body }}
            />
            <GlassButton
              title="Create folder"
              disabled={busy || !name.trim()}
              onPress={() =>
                void run(async () => {
                  const path = await store.invoke(computerId, 'folders.create', listing.path, name)
                  setListing(await store.invoke(computerId, 'folders.list', path))
                  setName('')
                })
              }
            />
            <GlassButton
              title={busy ? t.githubSearching : t.githubSearchButton}
              disabled={busy}
              onPress={() =>
                void run(async () =>
                  setFound(await store.invoke(computerId, 'forge.searchRepositories', search.trim())),
                )
              }
            />
            {found && !found.length ? <T tone="muted">{t.githubNoRepositories}</T> : null}
            {found?.length ? <T tone="muted">{t.githubPickHint}</T> : null}
            {found?.map((repository) => (
              <Row
                key={repository.fullName}
                onPress={() => {
                  setUrl(repository.cloneUrl)
                  setName(repository.fullName.split('/')[1] ?? '')
                }}
              >
                <T style={{ flex: 1 }}>
                  {repository.fullName}
                  {repository.private ? ` · ${t.githubPrivate}` : ''}
                </T>
              </Row>
            ))}
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="Git HTTPS or SSH URL"
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor={c.muted}
              style={{ padding: space.m, backgroundColor: c.fill, color: c.text, fontSize: font.body }}
            />
            <GlassButton
              title={busy ? (cloneProgress ?? 'Working on host…') : 'Clone repository'}
              disabled={busy || !url.trim() || !name.trim()}
              onPress={() =>
                void run(async () => {
                  // Only a host that answers the progress call also understands the clone id.
                  const supported = await store.invoke(computerId, 'folders.cloneProgress', 'probe-unused-id').then(
                    () => true,
                    () => false,
                  )
                  const id = `clone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
                  activeClone.current = supported ? id : null
                  setCancellable(supported)
                  const timer = supported
                    ? setInterval(
                        () =>
                          void store.invoke(computerId, 'folders.cloneProgress', id).then(
                            (next) =>
                              activeClone.current === id &&
                              setCloneProgress(
                                next ? `${next.phase}${next.percent === null ? '' : ` ${next.percent}%`}` : null,
                              ),
                            () => {},
                          ),
                        800,
                      )
                    : undefined
                  try {
                    const path = supported
                      ? await store.invoke(computerId, 'folders.clone', listing.path, name, url, id)
                      : await store.invoke(computerId, 'folders.clone', listing.path, name, url)
                    setListing(await store.invoke(computerId, 'folders.list', path))
                    setName('')
                    setUrl('')
                  } finally {
                    clearInterval(timer)
                    activeClone.current = null
                    setCloneProgress(null)
                    setCancellable(false)
                  }
                })
              }
            />
            {busy && cancellable ? (
              <GlassButton
                title="Cancel clone"
                onPress={() => {
                  const id = activeClone.current
                  if (id) void store.invoke(computerId, 'folders.cancelClone', id).catch(() => {})
                }}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
      {listing ? (
        <BottomSearch
          value={search}
          onChangeText={setSearch}
          placeholder={t.githubSearch}
          onSubmit={() => {
            if (!busy)
              void run(async () => setFound(await store.invoke(computerId, 'forge.searchRepositories', search.trim())))
          }}
        />
      ) : null}
    </Screen>
  )
}
