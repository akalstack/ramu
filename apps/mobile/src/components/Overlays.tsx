import { useEffect, useState, useSyncExternalStore, type ComponentProps } from 'react'
import { useRouter } from 'expo-router'
import { Monitor, Plus, RefreshCw, Settings, Search, SquareTerminal } from 'lucide-react-native'
import { space, useTheme } from '../theme'
import { counts, useStore } from '../runtime/store'
import { useT } from '../i18n'
import { HeaderButton } from './Screen'
import { ConnectionDot, Row, Sheet, T, tap, type Icon } from './ui'
import { SheetGroup, SheetOption } from './SheetOptions'

// Shared host and connection sheets. New thread uses one native-stack page for its project list and composer.

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
const needComputer = signal<NeedComputer | null>(null)
export const openComputerMenu = () => computerMenu.set(true)
export const openNeedComputer = (reason: NeedComputer) => needComputer.set(reason)

/** Let a closing sheet finish before the next screen or sheet appears over it. */
const later = (run: () => void) => setTimeout(run, 300)

function ComputerMenu() {
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
      <SheetGroup>
        {store.computers.map((pc) => {
          const n = counts(store.chats, pc.id)
          return (
            <SheetOption
              key={pc.id}
              icon={Monitor}
              title={pc.name}
              help={[
                pc.address.replace(/^https?:\/\//, ''),
                n.running ? `${n.running} ${t.running}` : '',
                n.waiting ? `${n.waiting} ${t.waiting}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
              selected={pc.id === store.selected}
              trailing={<ConnectionDot status={pc.status} />}
              onPress={() => {
                store.select(pc.id)
                close()
              }}
            />
          )
        })}
        <SheetOption icon={Plus} title={t.pair} onPress={() => go(() => router.push('/pair'))} />
      </SheetGroup>
      {projectList.length ? (
        <SheetGroup title={t.terminal}>
          {projectList.map((p) => (
            <SheetOption
              key={p.id}
              icon={SquareTerminal}
              title={p.name}
              onPress={() =>
                go(() =>
                  router.push({
                    pathname: '/terminal',
                    params: { computer: store.selected, ctx: `project:${p.id.slice(p.id.indexOf(':') + 1)}` },
                  }),
                )
              }
            />
          ))}
        </SheetGroup>
      ) : null}
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
      <NeedComputerSheet />
    </>
  )
}

/**
 * The actions every tab carries in its navigation bar: Search (unless the screen supplies its own primary action)
 * and Settings, always last on the right.
 */
export function useTabActions(
  primary?: {
    icon: Icon
    label: string
    systemIcon: ComponentProps<typeof HeaderButton>['systemIcon']
    onPress: () => void
  } | null,
) {
  const t = useT()
  const router = useRouter()
  return (
    <>
      {primary === null ? null : primary ? (
        <HeaderButton {...primary} actionId="tab-primary" />
      ) : (
        <HeaderButton
          actionId="tab-primary"
          icon={Search}
          label={t.searchTab}
          systemIcon="magnifyingglass"
          onPress={() => router.push('/search')}
        />
      )}
      <HeaderButton
        actionId="tab-settings"
        icon={Settings}
        label={t.settings}
        systemIcon="gearshape"
        onPress={() => router.push('/settings')}
      />
    </>
  )
}
