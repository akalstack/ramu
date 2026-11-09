import { useEffect, useState } from 'react'
import type { AgentHostSummary } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Dialog as ConfirmDialog } from '../Menu'
import { invoke } from '../ipc'
import { errorText } from '../lib/errors'
import { notifyError } from '../chat/Notifications'
import { t, useLanguage } from '../i18n'
import { useComputers } from '../workspace/computers'
import { unlistedAgentHosts } from './agentHostLinks'
import { SettingsCard, SettingsCardList, SettingsSectionHead } from './cards'

/**
 * Hosts agents here use that have no row in the host list, where Agents is otherwise turned on and off. They come from
 * `ramu hosts add`, which pairs with a code and needs no desktop pairing.
 */
export function AgentHosts() {
  useLanguage()
  const computers = useComputers()
  const [hosts, setHosts] = useState<AgentHostSummary[] | null>(null)
  const [forgetting, setForgetting] = useState<AgentHostSummary | null>(null)
  useEffect(() => {
    void invoke('network.agentHosts').then(setHosts, () => setHosts([]))
  }, [])
  const unlisted = unlistedAgentHosts(hosts ?? [], computers?.computers ?? [])
  if (!unlisted.length) return null
  return (
    <>
      <SettingsSectionHead
        title={t('Hosts added for agents')}
        help={t(
          'Agents here may start threads on these hosts. They were added with ramu hosts add, so they have no row above.',
        )}
      />
      <SettingsCardList>
        {unlisted.map((host) => (
          <SettingsCard
            key={host.id}
            title={host.name}
            meta={t('{0} · this computer is device {1} there', { 0: host.address, 1: host.deviceId })}
            actions={
              <Button variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={() => setForgetting(host)}>
                {t('Forget')}
              </Button>
            }
          />
        ))}
      </SettingsCardList>
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
    </>
  )
}
