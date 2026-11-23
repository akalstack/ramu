import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react-native'
import type { HostNameInfo } from '@ramu/shared/types'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import type { Computer } from '../runtime/types'
import { space, useTheme } from '../theme'
import { RowLabel, TextRow } from './SettingRows'
import { Card, Divider, Row } from './ui'
import { showError } from '../runtime/toast'

/**
 * What this phone calls a host, and what the host calls this phone, each with a way back to the original: the host's
 * own name, and the name the phone paired with.
 */
export function HostNames({ computer }: { computer: Computer }) {
  const say = useSay()
  const { c } = useTheme()
  const store = useStore()
  const [info, setInfo] = useState<HostNameInfo | null>(null)
  const online = computer.status === 'online'
  useEffect(() => {
    if (!online) return
    let live = true
    // A host too old to say its name keeps the phone's rows only.
    void store.invoke(computer.id, 'host.name').then(
      (value) => live && setInfo(value),
      () => {},
    )
    return () => {
      live = false
    }
  }, [computer.id, online, store])
  const renameSelf = async (name: string | null) => {
    try {
      await store.invoke(computer.id, 'device.rename', name)
      setInfo(await store.invoke(computer.id, 'host.name'))
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <Card style={{ marginHorizontal: space.l }}>
      <TextRow
        title={say('Name on this phone')}
        help={say('Only this phone uses it. The computer keeps its own name.')}
        value={computer.name}
        maxLength={60}
        onCommit={(name) => void store.rename(computer.id, name.trim() || info?.name || computer.name)}
      />
      {info && info.name !== computer.name ? (
        <>
          <Divider inset={space.l} />
          <Row onPress={() => void store.rename(computer.id, info.name)}>
            <RowLabel title={say('Use “{0}”', { 0: info.name })} help={say('The name the computer gives itself.')} />
            <RotateCcw size={16} color={c.muted} />
          </Row>
        </>
      ) : null}
      {info?.device ? (
        <>
          <Divider inset={space.l} />
          <TextRow
            title={say('This phone’s name there')}
            help={say('How {0} lists this phone.', { 0: computer.name })}
            value={info.device.name}
            maxLength={60}
            onCommit={(name) => void renameSelf(name.trim() || null)}
          />
          {info.device.renamed ? (
            <>
              <Divider inset={space.l} />
              <Row onPress={() => void renameSelf(null)}>
                <RowLabel title={say('Use the name it paired with')} />
                <RotateCcw size={16} color={c.muted} />
              </Row>
            </>
          ) : null}
        </>
      ) : null}
    </Card>
  )
}
