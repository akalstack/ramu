import { useContext } from 'react'
import type { Computer } from '@ramu/shared/types'
import { t, useLanguage } from '../../i18n'
import { useComputers } from '../../workspace/computers'
import { SettingsScopeContext } from '../SettingsScope'
import type { DraftProps } from '../ToggleRow'
import { AccessSection } from './AccessSection'
import { AccountDevices } from './AccountDevices'
import { ConnectDevice } from './ConnectDevice'
import { HostsYouUse } from './HostsYouUse'
import { LinkedHosts } from './LinkedHosts'
import { PairedDevices } from './PairedDevices'
import { ReachableFrom } from './ReachableFrom'
import { useNetworkStatus } from './useNetworkStatus'

/**
 * Settings › Devices & access, in the order a person sets a host up: who can reach it, connecting a device, the devices
 * that use it, devices on the Ramu account, hosts whose agents work together, then the hosts this computer uses.
 */
export function DevicesAccessSettings(props: DraftProps) {
  useLanguage()
  const state = useComputers()
  const settingsScope = useContext(SettingsScopeContext)
  if (!state) return null
  const here = state.computers.find((computer) => computer.id === (settingsScope?.primaryId ?? state.current))
  return (
    <div className="settings-form flex flex-col gap-0">
      {here?.local === false ? (
        <>
          <AccessSection
            title={t('Devices')}
            help={t('You are looking at {0}. Who can connect is set on that host.', { 0: here.name })}
          />
          <LinkedHosts computers={state.computers} />
        </>
      ) : (
        <ThisHost {...props} computers={state.computers} />
      )}
      <HostsYouUse state={state} />
    </div>
  )
}

/** Everything about who reaches the host this window runs on, read from one status that follows pairings as they land. */
function ThisHost({ computers, ...props }: DraftProps & { computers: Computer[] }) {
  const [status, setStatus, reload] = useNetworkStatus(2500)
  if (!status) return null
  return (
    <>
      <ReachableFrom {...props} status={status} onStatus={setStatus} />
      <ConnectDevice onClosed={() => void reload()} />
      <PairedDevices status={status} onStatus={setStatus} />
      <AccountDevices />
      <LinkedHosts computers={computers} status={status} onStatus={setStatus} />
    </>
  )
}
