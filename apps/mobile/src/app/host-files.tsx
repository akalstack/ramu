import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ArrowUp, ChevronRight, Copy, Folder } from 'lucide-react-native'
import type { DirEntry } from '@ramu/shared/types'
import { HOST_FILES_REPO } from '@ramu/shared/workspace/fileLinks'
import { FileIcon } from '../components/FileIcon'
import { Header, HeaderButton, PageFlatList, Screen } from '../components/Screen'
import { Row, T } from '../components/ui'
import { useSay, useT } from '../i18n'
import { useStore } from '../runtime/store'
import { font, space, useTheme } from '../theme'

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/**
 * The folder around a file a thread opened outside its folders, such as a report an agent wrote to a temp folder.
 * It walks folders toward `/` and opens files in the file screen; it only browses, since changes to files outside the
 * thread's folders go through that screen's editor. Paths are relative to `/`, as host-file paths are everywhere.
 */
export default function HostFiles() {
  const params = useLocalSearchParams<{ computer: string; ctx: string; path: string; file?: string }>()
  const store = useStore()
  const router = useRouter()
  const say = useSay()
  const t = useT()
  const { c } = useTheme()
  const [folder, setFolder] = useState(params.path ?? '')
  const [listing, setListing] = useState<{ folder: string; entries: DirEntry[]; truncated: boolean } | null>(null)
  const [error, setError] = useState('')
  const online = store.isOnline(params.computer)
  useEffect(() => {
    if (!online) return
    let current = true
    setError('')
    store
      .invoke(params.computer, 'files.browse', params.ctx, HOST_FILES_REPO, folder)
      .then((page) => current && setListing({ folder, entries: page.entries, truncated: page.truncated }))
      .catch((cause: unknown) => current && setError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lists again when the folder, host or thread changes
  }, [folder, params.computer, params.ctx, online])
  const shown = listing?.folder === folder ? listing : null
  const absolute = `/${folder}`

  return (
    <Screen bg="canvas">
      <Header
        title={folder ? folder.slice(folder.lastIndexOf('/') + 1) : '/'}
        subtitle={
          <T size={font.caption} tone="muted" numberOfLines={1}>
            {store.computers.find((host) => host.id === params.computer)?.name} · {say('Outside the project')}
          </T>
        }
        right={
          <HeaderButton
            icon={Copy}
            label={say('Copy path')}
            systemIcon="doc.on.doc"
            onPress={() => void Clipboard.setStringAsync(absolute)}
          />
        }
      />
      <PageFlatList
        data={shown?.entries ?? []}
        keyExtractor={(entry) => entry.path}
        ListHeaderComponent={
          <View style={{ gap: space.s, paddingBottom: space.s }}>
            <T size={font.caption} mono tone="muted" numberOfLines={2} style={{ paddingHorizontal: space.l }}>
              {absolute}
            </T>
            {folder ? (
              <Row onPress={() => setFolder(parentOf(folder))} accessibilityLabel={say('Parent folder')}>
                <ArrowUp size={18} color={c.soft} />
                <T style={{ flex: 1 }}>{say('Parent folder')}</T>
              </Row>
            ) : null}
            {!online ? <T tone="muted">{t.explorerOffline}</T> : null}
            {error ? <T tone="bad">{error}</T> : null}
            {online && !shown && !error ? <ActivityIndicator color={c.accent} /> : null}
          </View>
        }
        ListFooterComponent={
          shown?.truncated ? (
            <T tone="muted" style={{ padding: space.l }}>
              {say('Showing the first {0} items.', { 0: shown.entries.length.toLocaleString() })}
            </T>
          ) : undefined
        }
        renderItem={({ item }) => (
          <Row
            accessibilityLabel={item.name}
            onPress={() =>
              item.kind === 'dir'
                ? setFolder(item.path)
                : router.push({
                    pathname: '/file',
                    params: { computer: params.computer, ctx: params.ctx, repoId: HOST_FILES_REPO, path: item.path },
                  })
            }
            style={item.path === params.file ? { backgroundColor: c.accentSoft } : undefined}
          >
            {item.kind === 'dir' ? <Folder size={18} color={c.soft} /> : <FileIcon path={item.path} size={18} />}
            <T style={{ flex: 1 }} numberOfLines={1}>
              {item.name}
            </T>
            {item.kind === 'dir' ? <ChevronRight size={16} color={c.muted} /> : null}
          </Row>
        )}
      />
    </Screen>
  )
}
