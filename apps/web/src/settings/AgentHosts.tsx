import { useEffect, useState } from 'react'
import type { AgentHostSummary } from '@ramu/shared/types'
import { parsePairInput } from '@ramu/contracts'
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
import { Dialog as ConfirmDialog, Dropdown } from '../Menu'
import { invoke } from '../ipc'
import { errorText } from '../lib/errors'
import { notifyError } from '../chat/Notifications'
import { t, useLanguage } from '../i18n'
import { useComputers } from '../workspace/computers'
import { agentHostChoices } from './agentHostChoices'
import { SettingsCard, SettingsCardList, SettingsSectionHead } from './cards'

const OTHER_HOST = 'other'

/**
 * Other hosts this host's agents may start threads on. Adding one pairs this host there with a code from that host; the
 * pairing can only start and follow threads, under that host's access ceiling. Managed only here, on this host.
 */
export function AgentHosts() {
  useLanguage()
  const [hosts, setHosts] = useState<AgentHostSummary[] | null>(null)
  const [adding, setAdding] = useState(false)
  const computers = useComputers()
  const [choice, setChoice] = useState(OTHER_HOST)
  const [form, setForm] = useState({ address: '', code: '', name: '' })
  const [busy, setBusy] = useState(false)
  const [forgetting, setForgetting] = useState<AgentHostSummary | null>(null)
  useEffect(() => {
    void invoke('network.agentHosts').then(setHosts, () => setHosts([]))
  }, [])
  const choices = agentHostChoices(computers?.computers ?? [], hosts ?? [])
  const pick = (id: string) => {
    const computer = choices.find((entry) => entry.id === id)
    setChoice(id)
    setForm((current) => ({ ...current, address: computer?.url ?? '', name: computer?.name ?? '' }))
  }
  const open = () => {
    setForm({ address: '', code: '', name: '' })
    if (choices[0]) pick(choices[0].id)
    else setChoice(OTHER_HOST)
    setAdding(true)
  }
  // A pasted pairing link carries the address too, so it fills both; a bare code is left as typed.
  const enterCode = (text: string) => {
    setForm((current) => ({ ...current, code: text }))
    if (!/^(ramu:|https?:|\{)/i.test(text.trim())) return
    try {
      const parsed = parsePairInput(text)
      setChoice(OTHER_HOST)
      setForm((current) => ({
        address: parsed.url,
        code: parsed.code ?? '',
        name: current.name || (parsed.name ?? ''),
      }))
    } catch (error) {
      notifyError(errorText(error), t('Hosts for agents'))
    }
  }
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
      <SettingsSectionHead
        title={t('Hosts for agents')}
        help={t('Let agents here start threads on another host. You approve each start.')}
        action={
          <Button variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={open}>
            <Plus size={14} />
            {t('Add a host…')}
          </Button>
        }
      />
      {hosts.length > 0 && (
        <SettingsCardList>
          {hosts.map((host) => (
            <SettingsCard
              key={host.id}
              title={host.name}
              meta={t('{0} · shown there as device {1}', { 0: host.address, 1: host.deviceId })}
              actions={
                <Button variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={() => setForgetting(host)}>
                  {t('Forget')}
                </Button>
              }
            />
          ))}
        </SettingsCardList>
      )}
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
                    'Get a pairing code on that host: run ramu pair, or open Settings → Remote access → Pair a device.',
                  )}
                </DialogDescription>
              </DialogHeader>
              {choices.length > 0 && (
                <div className="flex flex-col gap-1 text-caption text-muted-foreground">
                  {t('Host')}
                  <Dropdown
                    label={t('Host')}
                    value={choice}
                    options={[
                      ...choices.map((computer) => ({ value: computer.id, label: computer.name })),
                      { value: OTHER_HOST, label: t('Another host') },
                    ]}
                    onChange={pick}
                  />
                </div>
              )}
              {choice === OTHER_HOST && (
                <label className="flex flex-col gap-1 text-caption text-muted-foreground">
                  {t('Address')}
                  <Input
                    placeholder="http://100.64.0.2:7788"
                    autoFocus
                    value={form.address}
                    onChange={(event) => setForm({ ...form, address: event.target.value })}
                  />
                </label>
              )}
              <label className="flex flex-col gap-1 text-caption text-muted-foreground">
                {t('Pairing link or code')}
                <Input
                  placeholder="K7QM2-X9RTD"
                  autoFocus={choice !== OTHER_HOST}
                  value={form.code}
                  onChange={(event) => enterCode(event.target.value)}
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
              <p className="m-0 text-caption text-muted-foreground">
                {t(
                  'Agents can only start, check and message the threads they start. That host decides their model and the most access they get.',
                )}
              </p>
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
