import { useState } from 'react'
import { useRouter } from 'expo-router'
import { FolderGit2, Network, Plus, Settings } from 'lucide-react-native'
import { counts, useStore } from '../runtime/store'
import { ago, useSay, useT } from '../i18n'
import { Chip, ConnectionDot, Sheet } from './ui'
import { SheetGroup, SheetOption } from './SheetOptions'

type AllHosts = {
  all?: boolean
  onAll?: (all: boolean) => void
  /** In All hosts: whether one repository's projects on several hosts show as one group or one per host. */
  byHost?: { separate: boolean; onChange: (separate: boolean) => void }
}

/**
 * The one host control every tab leads its chip row with: the host it shows (or All hosts) and its connection; tap to
 * switch hosts or pair another. `onAll` offers All hosts, for a list that can merge every host; without a paired host
 * the chip pairs one.
 */
export function HostChip({ all = false, onAll, byHost }: AllHosts) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <HostChipButton all={all} onAll={onAll} onOpen={() => setOpen(true)} />
      <HostSheet open={open} onClose={() => setOpen(false)} all={all} onAll={onAll} byHost={byHost} />
    </>
  )
}

/**
 * The chip alone, for a navigation bar: a native bar item cannot hold the sheet, so the screen draws `HostSheet` in its
 * body. `compact` fits beside a centred title.
 */
export function HostChipButton({
  all = false,
  onAll,
  onOpen,
  compact,
}: AllHosts & { onOpen: () => void; compact?: boolean }) {
  const t = useT()
  const router = useRouter()
  const store = useStore()
  const pc = store.computers.find((x) => x.id === store.selected)
  if (!store.computers.length)
    return <Chip label={t.pair} icon={Plus} small={compact} onPress={() => router.push('/welcome')} />
  const merged = all && !!onAll
  return (
    <Chip
      label={merged ? t.allHosts : (pc?.name ?? t.allHosts)}
      accessibilityLabel={t.homeFilterHost}
      icon={merged ? Network : undefined}
      status={merged ? undefined : pc?.status}
      chevron
      small={compact}
      maxLabelWidth={compact ? 84 : 150}
      onPress={onOpen}
    />
  )
}

export function HostSheet({
  open,
  onClose,
  all = false,
  onAll,
  byHost,
}: AllHosts & { open: boolean; onClose: () => void }) {
  const t = useT()
  const say = useSay()
  const router = useRouter()
  const store = useStore()
  const merged = all && !!onAll
  const choose = (run: () => void) => {
    run()
    onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title={t.homeHost}>
      <SheetGroup>
        {onAll ? (
          <SheetOption icon={Network} title={t.allHosts} selected={merged} onPress={() => choose(() => onAll(true))} />
        ) : null}
        {store.computers.map((x) => {
          const n = counts(store.chats, x.id)
          return (
            <SheetOption
              key={x.id}
              icon={Network}
              title={x.name}
              help={[
                x.status === 'online' || !x.lastSeen ? t[x.status] : `${t[x.status]} · ${ago(x.lastSeen)}`,
                n.running ? `${n.running} ${t.running}` : '',
                n.waiting ? `${n.waiting} ${t.waiting}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
              trailing={<ConnectionDot status={x.status} />}
              selected={!merged && x.id === store.selected}
              onPress={() =>
                choose(() => {
                  store.select(x.id)
                  onAll?.(false)
                })
              }
            />
          )
        })}
      </SheetGroup>
      {merged && byHost ? (
        <SheetGroup title={say('A project on several hosts')}>
          <SheetOption
            icon={FolderGit2}
            title={say('One group')}
            help={say('A repository on several hosts is one project, each thread naming its host.')}
            selected={!byHost.separate}
            onPress={() => choose(() => byHost.onChange(false))}
          />
          <SheetOption
            icon={Network}
            title={say('Separate by host')}
            selected={byHost.separate}
            onPress={() => choose(() => byHost.onChange(true))}
          />
        </SheetGroup>
      ) : null}
      <SheetGroup>
        <SheetOption icon={Plus} title={t.pair} onPress={() => choose(() => router.push('/pair'))} />
        <SheetOption icon={Settings} title={t.manageHosts} onPress={() => choose(() => router.push('/computers'))} />
      </SheetGroup>
    </Sheet>
  )
}
