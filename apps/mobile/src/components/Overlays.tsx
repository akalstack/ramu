import { useEffect, useState, useSyncExternalStore, type ComponentProps } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import {
  Check,
  Folder,
  FolderGit2,
  MessagesSquare,
  Monitor,
  Plus,
  RefreshCw,
  Settings,
  SquarePen,
  SquareTerminal,
} from 'lucide-react-native'
import { font, space, useTheme } from '../theme'
import { counts, useStore } from '../runtime/store'
import { STANDALONE } from '../runtime/types'
import { useT } from '../i18n'
import { HeaderButton } from './Screen'
import { ConnectionDot, Row, SectionLabel, Sheet, T, tap, type Icon } from './ui'

// Sheets that every tab opens from its header: the computer menu and the project picker for a new thread.
// They are mounted once at the root, so a tab only calls `openComputerMenu()` or `openNewThread()`.

function signal<V>(initial: V) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    set(next: V) {
      value = next
      for (const listener of listeners) listener()
    },
    use: () =>
      useSyncExternalStore(
        (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        () => value,
      ),
  }
}
/** Why an action that needs a computer cannot run: none paired, pairing revoked, or the computer is unreachable. */
export type NeedComputer = 'none' | 'revoked' | 'offline'
const computerMenu = signal(false)
const newThread = signal(false)
const needComputer = signal<NeedComputer | null>(null)
export const openComputerMenu = () => computerMenu.set(true)
export const openNewThread = () => newThread.set(true)
export const openNeedComputer = (reason: NeedComputer) => needComputer.set(reason)

/** Let a closing sheet finish before the next screen or sheet appears over it. */
const later = (run: () => void) => setTimeout(run, 300)

function ComputerMenu() {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const store = useStore()
  const open = computerMenu.use()
  const close = () => computerMenu.set(false)
  const go = (run: () => void) => {
    tap()
    close()
    later(run)
  }
  const projectList = store.projects.filter((p) => p.computerId === store.selected)
  return (
    <Sheet open={open} onClose={close} title={t.computers}>
      {store.computers.map((pc) => {
        const n = counts(store.chats, pc.id)
        const here = pc.id === store.selected
        return (
          <Row
            key={pc.id}
            onPress={() => {
              tap()
              store.select(pc.id)
              close()
            }}
          >
            <Monitor size={17} color={here ? c.accent : c.soft} strokeWidth={1.8} />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <T weight={here ? '600' : '500'} numberOfLines={1} style={{ flexShrink: 1 }}>
                  {pc.name}
                </T>
                <ConnectionDot status={pc.status} />
              </View>
              <T size={font.caption} tone="muted" numberOfLines={1}>
                {[
                  pc.address.replace(/^https?:\/\//, ''),
                  n.running ? `${n.running} ${t.running}` : '',
                  n.waiting ? `${n.waiting} ${t.waiting}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </T>
            </View>
            {here ? <Check size={16} color={c.accent} /> : null}
          </Row>
        )
      })}
      <Row onPress={() => go(() => router.push('/pair'))}>
        <Plus size={17} color={c.soft} />
        <T style={{ flex: 1 }}>{t.pair}</T>
      </Row>
      {projectList.length ? <SectionLabel>{t.terminal}</SectionLabel> : null}
      {projectList.map((p) => (
        <Row
          key={p.id}
          onPress={() =>
            go(() =>
              router.push({
                pathname: '/terminal',
                params: { computer: store.selected, ctx: `project:${p.id.slice(p.id.indexOf(':') + 1)}` },
              }),
            )
          }
        >
          <SquareTerminal size={17} color={c.soft} />
          <T style={{ flex: 1 }} numberOfLines={1}>
            {p.name}
          </T>
        </Row>
      ))}
    </Sheet>
  )
}

function NewThreadSheet() {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const store = useStore()
  const open = newThread.use()
  const close = () => newThread.set(false)
  const pc = store.computers.find((x) => x.id === store.selected)
  const start = (project: string) => {
    close()
    later(() => router.push({ pathname: '/new', params: { project, computer: store.selected } }))
  }
  return (
    <Sheet open={open} onClose={close} title={t.newChat}>
      {store.computers.length > 1 &&
        store.computers.map((computer) => (
          <Row key={computer.id} onPress={() => store.select(computer.id)}>
            <Monitor size={17} color={c.soft} />
            <View style={{ flex: 1 }}>
              <T weight="500">{computer.name}</T>
              <T size={font.caption} tone="muted">
                {t[computer.status]}
              </T>
            </View>
            {computer.id === store.selected ? <Check size={16} color={c.accent} /> : null}
          </Row>
        ))}
      {store.projects
        .filter((p) => p.computerId === store.selected)
        .map((p) => (
          <Row key={p.id} onPress={() => start(p.id)}>
            {p.kind === 'workspace' ? <Folder size={17} color={c.soft} /> : <FolderGit2 size={17} color={c.soft} />}
            <View style={{ flex: 1 }}>
              <T weight="500" numberOfLines={1}>
                {p.name}
              </T>
              <T size={font.caption} tone="muted" numberOfLines={1}>
                {p.root}
              </T>
            </View>
          </Row>
        ))}
      <Row onPress={() => start(STANDALONE)}>
        <MessagesSquare size={17} color={c.soft} />
        <View style={{ flex: 1 }}>
          <T weight="500">Standalone</T>
          <T size={font.caption} tone="muted">
            No project folder
          </T>
        </View>
      </Row>
      <Row
        onPress={() => {
          close()
          later(() => router.push('/folders'))
        }}
      >
        <Monitor size={17} color={c.muted} />
        <T tone="muted">Add a folder on {pc?.name}…</T>
      </Row>
    </Sheet>
  )
}

/** The answer to a tap that cannot work yet: say why, and offer the fix, instead of doing nothing. */
function NeedComputerSheet() {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const store = useStore()
  const reason = needComputer.use()
  const [shown, setShown] = useState<NeedComputer>('none')
  // Keep the last reason while the sheet slides away, so its text does not flicker.
  useEffect(() => {
    if (reason) setShown(reason)
  }, [reason])
  const close = () => needComputer.set(null)
  const title = { none: t.noComputer, revoked: t.revokedTitle, offline: t.offline }[shown]
  const hint = { none: t.noComputerHint, revoked: t.revokedHint, offline: t.offlineNeeded }[shown]
  return (
    <Sheet open={reason !== null} onClose={close} title={title}>
      <T tone="muted" style={{ paddingHorizontal: space.l + 4, paddingBottom: space.m, lineHeight: 21 }}>
        {hint}
      </T>
      {shown === 'offline' ? (
        <Row
          onPress={() => {
            tap()
            close()
            store.retry(store.selected)
          }}
        >
          <RefreshCw size={17} color={c.soft} />
          <T style={{ flex: 1 }}>{t.reconnect}</T>
        </Row>
      ) : (
        <Row
          onPress={() => {
            tap()
            close()
            later(() => router.push('/pair'))
          }}
        >
          <Plus size={17} color={c.accent} />
          <T tone="accent" weight="600" style={{ flex: 1 }}>
            {t.pair}
          </T>
        </Row>
      )}
    </Sheet>
  )
}

export function Overlays() {
  return (
    <>
      <ComputerMenu />
      <NewThreadSheet />
      <NeedComputerSheet />
    </>
  )
}

/** Starts a thread: the project picker, or the reason there is no computer to start one on. */
export function useStartThread() {
  const { computers, selected } = useStore()
  return () => {
    const pc = computers.find((x) => x.id === selected)
    if (!pc) openNeedComputer('none')
    else if (pc.status === 'revoked') openNeedComputer('revoked')
    else openNewThread()
  }
}

/**
 * The actions every tab carries in its navigation bar: a primary one (start a thread unless the screen says otherwise)
 * and Settings, always last on the right.
 */
export function useTabActions(primary?: {
  icon: Icon
  label: string
  systemIcon: ComponentProps<typeof HeaderButton>['systemIcon']
  onPress: () => void
}) {
  const t = useT()
  const router = useRouter()
  const start = useStartThread()
  return (
    <>
      {primary ? (
        <HeaderButton {...primary} />
      ) : (
        <HeaderButton icon={SquarePen} label={t.newChat} systemIcon="square.and.pencil" onPress={start} />
      )}
      <HeaderButton
        icon={Settings}
        label={t.settings}
        systemIcon="gearshape"
        onPress={() => router.push('/settings')}
      />
    </>
  )
}
