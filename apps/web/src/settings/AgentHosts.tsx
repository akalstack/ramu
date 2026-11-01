import { useEffect, useState } from 'react'
import type { AgentHostSummary } from '@ramu/shared/types'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Dialog as ConfirmDialog } from '../Menu'
import { invoke } from '../ipc'
import { errorText } from '../lib/errors'
import { notifyError } from '../chat/Notifications'
import { t, useLanguage } from '../i18n'

/**
 * Other hosts this host's agents may start threads on. Adding one pairs this host there with a code from that host; the
 * pairing can only start and follow threads, under that host's access ceiling. Managed only here, on this host.
 */
export function AgentHosts() {
  useLanguage()
  const [hosts, setHosts] = useState<AgentHostSummary[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ address: '', code: '', name: '' })
  const [busy, setBusy] = useState(false)
  const [forgetting, setForgetting] = useState<AgentHostSummary | null>(null)
  useEffect(() => {
    void invoke('network.agentHosts').then(setHosts, () => setHosts([]))
  }, [])
  const add = async () => {
    setBusy(true)
    try {
      setHosts(await invoke('network.addAgentHost', form.address, form.code, form.name || undefined))
      setForm({ address: '', code: '', name: '' })
      setAdding(false)
    } catch (error) {
      notifyError(errorText(error), t('Hosts for agents'))
    } finally {
      setBusy(false)
    }
  }
  if (!hosts) return null
  return (
    <>
      <SettingsGroupTitle className="mt-5">{t('Hosts for agents')}</SettingsGroupTitle>
      <SettingsRow>
        <SettingsLabel
          title={t('Add a host for agents')}
          help={t(
            'Agents here can start threads on these hosts, after you approve each start. A host pairing can only start, check and message the threads it starts; that host decides their model and the most access they get.',
          )}
        />
        <Button variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={() => setAdding(true)}>
          <Plus size={14} />
          {t('Add a host…')}
        </Button>
      </SettingsRow>
      {hosts.map((host) => (
        <SettingsRow key={host.id}>
          <SettingsLabel
            title={host.name}
            help={t('{0} · shown there as device {1}', { 0: host.address, 1: host.deviceId })}
          />
          <Button variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={() => setForgetting(host)}>
            {t('Forget')}
          </Button>
        </SettingsRow>
      ))}
      {adding && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setAdding(false)
          }}
        >
          <DialogContent className="sm:max-w-[480px]">
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                void add()
              }}
            >
              <DialogHeader>
                <DialogTitle>{t('Add a host for agents')}</DialogTitle>
                <DialogDescription>
                  {t(
                    'On the other host, run ramu pair or open Settings → Remote access → Pair a device, then enter its address and code.',
                  )}
                </DialogDescription>
              </DialogHeader>
              <label className="flex flex-col gap-1 text-caption text-muted-foreground">
                {t('Address')}
                <Input
                  placeholder="http://100.64.0.2:7788"
                  autoFocus
                  value={form.address}
                  onChange={(event) => setForm({ ...form, address: event.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-caption text-muted-foreground">
                {t('Pairing code')}
                <Input
                  placeholder="K7QM2-X9RTD"
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-caption text-muted-foreground">
                {t('Name agents use')}
                <Input
                  placeholder="vps"
                  maxLength={80}
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>
              <DialogFooter>
                <Button
                  variant="secondary"
                  className="bg-fill hover:bg-fill-hover"
                  disabled={busy}
                  onClick={() => setAdding(false)}
                >
                  {t('Cancel')}
                </Button>
                <Button type="submit" disabled={busy || !form.address.trim() || !form.code.trim()}>
                  {t('Add host')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
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
              notifyError(errorText(error), t('Hosts for agents')),
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
