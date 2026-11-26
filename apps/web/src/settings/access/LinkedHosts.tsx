import { useCallback, useEffect, useState } from 'react'
import type { AgentHostSummary, Computer, NetworkDevice, NetworkStatus } from '@ramu/shared/types'
import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import { Dialog as ConfirmDialog, timeAgo } from '../../Menu'
import { invoke } from '../../ipc'
import { errorText } from '../../lib/errors'
import { notifyError } from '../../chat/Notifications'
import { t } from '../../i18n'
import { agentReachable, agentsOnEverywhere, unlistedAgentHosts } from '../agentHostLinks'
import { SETTINGS_CARD_LINE, SettingsCard, SettingsCardList, SettingsEmpty, SettingsSectionHead } from '../cards'
import { AgentsOnHost, HostCeiling, type PermissionInvoke } from '../DevicePermissions'
import { useSettingsInvoke } from '../SettingsScope'
import { AccessSection } from './AccessSection'
import { RemoveDevice } from './PairedDevices'

/**
 * Hosts whose agents work together: the hosts agents here may start threads on, and, on this host, the hosts whose
 * agents start threads here with the most access those threads get. `status` is this host's, absent while Settings
 * shows another host, whose own page lists who links to it.
 */
export function LinkedHosts({
  computers,
  status,
  onStatus,
}: {
  computers: Computer[]
  status?: NetworkStatus
  onStatus?: (status: NetworkStatus) => void
}) {
  const [hosts, setHosts] = useState<AgentHostSummary[] | null>(null)
  const [everywhere, setEverywhere] = useState({ on: false, seq: 0 })
  const [forgetting, setForgetting] = useState<AgentHostSummary | null>(null)
  const refresh = useCallback(() => invoke('network.agentHosts').then(setHosts, () => setHosts([])), [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  const reachable = agentReachable(computers).flatMap((computer) =>
    computer.url ? [{ ...computer, url: computer.url }] : [],
  )
  const unlisted = unlistedAgentHosts(hosts ?? [], computers)
  const incoming = status?.devices.filter((device) => device.kind === 'host' || device.agentHost) ?? []
  const agents = { hosts, refresh, everywhere }
  return (
    <AccessSection
      title={t('Linked hosts')}
      help={t(
        'Agents on one host can start and follow threads on another. Every start asks you on the host that sends it.',
      )}
    >
      {!reachable.length && !unlisted.length && !incoming.length && (
        <SettingsEmpty>
          {t('No linked hosts. Add another host under Hosts you use, then let agents here start threads on it.')}
        </SettingsEmpty>
      )}
      {reachable.length > 0 && (
        <div className="mb-4 flex flex-col gap-1 rounded-(--radius-m) bg-fill px-4 py-2">
          {reachable.map((computer) => (
            <AgentsOnHost key={computer.id} computer={computer} agents={agents} />
          ))}
        </div>
      )}
      {reachable.length > 1 && (
        <SettingsRow className="settings-toggle">
          <SettingsLabel
            title={t('Agents on all hosts')}
            help={t('Let agents here start threads on every connected host. A host that has not allowed it is asked.')}
          />
          <Switch
            aria-label={t('Agents on all hosts')}
            checked={agentsOnEverywhere(reachable, hosts ?? [])}
            disabled={!hosts}
            onCheckedChange={(on) => setEverywhere((current) => ({ on, seq: current.seq + 1 }))}
          />
        </SettingsRow>
      )}
      {unlisted.length > 0 && (
        <>
          <SettingsSectionHead
            title={t('Hosts added for agents')}
            help={t(
              'Agents here can start threads on these hosts. They were added with ramu hosts add, so they have no row under Hosts you use.',
            )}
          />
          <SettingsCardList>
            {unlisted.map((host) => (
              <SettingsCard
                key={host.id}
                title={host.name}
                meta={t('{0} · this computer is device {1} there', { 0: host.address, 1: host.deviceId })}
                actions={
                  <Button
                    variant="secondary"
                    className="bg-fill hover:bg-fill-hover"
                    onClick={() => setForgetting(host)}
                  >
                    {t('Forget')}
                  </Button>
                }
              />
            ))}
          </SettingsCardList>
        </>
      )}
      {status && onStatus && incoming.length > 0 && <IncomingHosts devices={incoming} onStatus={onStatus} />}
      {forgetting && (
        <ConfirmDialog
          danger
          title={t('Forget {0}?', { 0: forgetting.name })}
          confirmLabel={t('Forget')}
          onCancel={() => setForgetting(null)}
          onConfirm={() => {
            const host = forgetting
            setForgetting(null)
            void invoke('network.forgetAgentHost', host.id).then(setHosts, (error) =>
              notifyError(errorText(error), t('Agents')),
            )
          }}
        >
          <p>
            {t(
              'Agents here stop using it. Threads already started there keep running. Revoke device {0} on that host to end the pairing there too.',
              { 0: forgetting.deviceId },
            )}
          </p>
        </ConfirmDialog>
      )}
    </AccessSection>
  )
}

/**
 * Hosts whose agents start threads here: one added with a code (`ramu hosts add`), which Remove ends, or a paired
 * computer granted Agents, which Turn off ends by asking first again.
 */
function IncomingHosts({ devices, onStatus }: { devices: NetworkDevice[]; onStatus: (status: NetworkStatus) => void }) {
  const settingsInvoke = useSettingsInvoke()
  const [removing, setRemoving] = useState<NetworkDevice | null>(null)
  const change: PermissionInvoke = async (method, ...args) => {
    try {
      onStatus(
        await (settingsInvoke as (method: string, ...args: unknown[]) => Promise<NetworkStatus>)(method, ...args),
      )
    } catch (error) {
      notifyError(errorText(error), t('Devices & access'))
    }
  }
  return (
    <>
      <SettingsSectionHead
        title={t('Hosts whose agents start threads here')}
        help={t('Threads they start here never get more access than you allow, whatever they ask for.')}
      />
      <SettingsCardList>
        {devices.map((device) => {
          const ceiling = device.agentHost ?? { id: device.id, maxAccess: device.maxAccess ?? 'edits' }
          return (
            <SettingsCard
              key={device.id}
              title={device.name}
              meta={
                device.agentHost
                  ? t('A paired computer allowed Agents')
                  : t('Another host’s agents: start and follow threads only · last seen {0}', {
                      0: device.lastSeenAt ? timeAgo(device.lastSeenAt) : t('never'),
                    })
              }
              actions={
                device.agentHost ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void change('network.setDevicePermission', device.id, 'agents', 'ask')}
                  >
                    {t('Turn off')}
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => setRemoving(device)}>
                    {t('Remove')}
                  </Button>
                )
              }
            >
              <div className={SETTINGS_CARD_LINE}>
                <span className="min-w-0 flex-1 truncate text-control">{t('Most access for its threads')}</span>
                <HostCeiling deviceId={ceiling.id} value={ceiling.maxAccess} invoke={change} />
              </div>
            </SettingsCard>
          )
        })}
      </SettingsCardList>
      {removing && (
        <RemoveDevice
          name={removing.name}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            void change('network.revoke', removing.id)
            setRemoving(null)
          }}
        />
      )}
    </>
  )
}
