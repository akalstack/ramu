import { BottomSearch } from '../components/BottomSearch'
import { goBackOrHome } from '../runtime/navigation'
import { useEffect, useRef, useState } from 'react'
import { TextInput, View, type ViewStyle } from 'react-native'
import { useRouter } from 'expo-router'
import { Folder, ChevronLeft, ChevronRight } from 'lucide-react-native'
import { Header, Screen, GlassButton, PageScrollView as ScrollView } from '../components/Screen'
import { Card, Divider, Row, T } from '../components/ui'
import { useStore } from '../runtime/store'
import { font, radius, space, useTheme } from '../theme'
import { useT, useSay } from '../i18n'
import type { ForgeRepositorySummary } from '@ramu/shared/types'
const FOLDER_ROW: ViewStyle = { minHeight: 44, paddingVertical: space.s, paddingHorizontal: space.m, gap: space.s }

export default function HostFolders() {
  const say = useSay()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [computerId] by design; the values it reads beyond these are current as of that run
  }, [computerId])
  return (
    <Screen bg="canvas">
      <Header modal title={say('Host folders')} subtitle={store.computers.find((c) => c.id === computerId)?.name} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.l, gap: space.m }}
      >
        {error ? <T tone="bad">{error}</T> : null}
        <T size={font.caption} tone="muted" numberOfLines={2} ellipsizeMode="head">
          {listing?.path ?? say('Choose where to start browsing')}
        </T>
        {/* The same rows as Explorer: one card, 44-point rows, small icons and a press highlight. */}
        <Card>
          {listing?.parent ? (
            <Row style={FOLDER_ROW} onPress={() => void browse(listing.parent!)}>
              <ChevronLeft color={c.soft} size={15} />
              <T style={{ flex: 1 }}>{say('Parent folder')}</T>
            </Row>
          ) : null}
          {(listing?.folders ?? roots.map((path) => ({ name: path, path }))).map((folder, index) => (
            <View key={folder.path}>
              {index || listing?.parent ? <Divider inset={space.m + 15 + space.s} /> : null}
              <Row style={FOLDER_ROW} onPress={() => void browse(folder.path)}>
                <Folder size={15} color={c.soft} />
                <T style={{ flex: 1 }} numberOfLines={2}>
                  {folder.name}
                </T>
                <ChevronRight size={15} color={c.muted} />
              </Row>
            </View>
          ))}
        </Card>
        {listing ? (
          <>
            <GlassButton
              title={say('Add this folder as a project')}
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
              placeholder={say('New folder / clone destination name')}
              placeholderTextColor={c.muted}
              style={{
                padding: space.m,
                borderRadius: radius.m,
                backgroundColor: c.fill,
                color: c.text,
                fontSize: font.body,
              }}
            />
            <GlassButton
              title={say('Create folder')}
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
              placeholder={say('Git HTTPS or SSH URL')}
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor={c.muted}
              style={{
                padding: space.m,
                borderRadius: radius.m,
                backgroundColor: c.fill,
                color: c.text,
                fontSize: font.body,
              }}
            />
            <GlassButton
              title={busy ? (cloneProgress ?? 'Working on host…') : 'Clone repository'}
              disabled={busy || !url.trim() || !name.trim()}
              onPress={() =>
                void run(async () => {
                  const id = `clone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
                  activeClone.current = id
                  setCancellable(true)
                  const timer = setInterval(
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
                  try {
                    const path = await store.invoke(computerId, 'folders.clone', listing.path, name, url, id)
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
                title={say('Cancel clone')}
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
