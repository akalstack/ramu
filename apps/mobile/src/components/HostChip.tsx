import { useState } from 'react'
import { useRouter } from 'expo-router'
import { Network, Plus } from 'lucide-react-native'
import { counts, useStore } from '../runtime/store'
import { ago, useT } from '../i18n'
import { Chip, ConnectionDot, Sheet } from './ui'
import { SheetGroup, SheetOption } from './SheetOptions'

/**
 * The one host control every tab leads its chip row with: the host it shows (or All hosts) and its connection; tap to
 * switch hosts or pair another. `onAll` offers All hosts, for a list that can merge every host; without a paired host
 * the chip pairs one.
 */
export function HostChip({ all = false, onAll }: { all?: boolean; onAll?: (all: boolean) => void }) {
  const t = useT()
  const router = useRouter()
  const store = useStore()
  const [open, setOpen] = useState(false)
  const pc = store.computers.find((x) => x.id === store.selected)
  if (!store.computers.length) return <Chip label={t.pair} icon={Plus} onPress={() => router.push('/pair')} />
  const merged = all && !!onAll
  const choose = (run: () => void) => {
    run()
    setOpen(false)
  }
  return (
    <>
      <Chip
        label={merged ? t.allHosts : (pc?.name ?? t.allHosts)}
        accessibilityLabel={t.homeFilterHost}
        icon={merged ? Network : undefined}
        status={merged ? undefined : pc?.status}
        chevron
        maxLabelWidth={150}
        onPress={() => setOpen(true)}
      />
      <Sheet open={open} onClose={() => setOpen(false)} title={t.homeHost}>
        <SheetGroup>
          {onAll ? (
            <SheetOption
              icon={Network}
              title={t.allHosts}
              selected={merged}
              onPress={() => choose(() => onAll(true))}
            />
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
        <SheetGroup>
          <SheetOption icon={Plus} title={t.pair} onPress={() => choose(() => router.push('/pair'))} />
        </SheetGroup>
      </Sheet>
    </>
  )
}
