import { SettingsScopeContext, useSettingsInvoke } from './SettingsScope'
import QRCode from 'qrcode'
import { encodePairLink, encodePairQr, parsePairInput } from '@ramu/contracts'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Check, Copy, Link2, Monitor, Network, Plus, Settings2, Terminal } from 'lucide-react'
import { useContext, useCallback, useEffect, useRef, useState } from 'react'
import type { Computer, Computers as ComputerList, NetworkStatus, PairingOffer } from '@ramu/shared/types'
import { Dialog as ConfirmDialog, Dropdown, timeAgo } from './Menu'
import { copyText, invoke } from './ipc'
import { errorText } from './errors'
import { notifyError } from './Notifications'
import { t, useLanguage } from './i18n'
import { StatusDot, activityText, statusText, useComputers } from './computers'
import { workspaceVisible } from './workspaceLifetime'
import { onPairLink, takePairLink } from './pairLink'

const ALL_NETWORKS = '0.0.0.0'
/** Virtual networks that Docker, VMs and macOS create. Another device almost never reaches this computer through them. */
const VIRTUAL_INTERFACE = /^(bridge|docker|br-|veth|vmnet|vboxnet|virbr|awdl|llw|anpi|ap|gif|stf)\d*/i
const DEFAULT_PORT = 7788

/** `m:ss` left until a pairing code expires. */
const countdown = (expiresAt: number, now: number) => { const left = Math.max(0, Math.round((expiresAt - now) / 1000)); return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` }

/** Polls while the screen is open: pairing happens on another device, so nothing here would otherwise know it finished. */
function useNetworkStatus(interval: number) {
  const invoke = useSettingsInvoke()
  const [status, setStatus] = useState<NetworkStatus | null>(null)
  const loading = useRef(false)
  const reload = useCallback(async () => {
    if (!workspaceVisible() || loading.current) return
    loading.current = true
    try { setStatus(await invoke('network.status')) } catch {} finally { loading.current = false }
  }, [])
  useEffect(() => { void reload(); const id = window.setInterval(() => void reload(), interval); return () => window.clearInterval(id) }, [reload, interval])
  return [status, setStatus, reload] as const
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return <Button variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={() => void copyText(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1400) })}>{done ? <Check size={14} /> : <Copy size={14} />}</Button>
}

export function RemoteAccessSettings() {
  useLanguage()
  const state = useComputers()
  const settingsScope = useContext(SettingsScopeContext)
  if (!state) return null
  const here = state.computers.find((computer) => computer.id === (settingsScope?.primaryId ?? state.current))
  return <div className="settings-form flex flex-col gap-0">
    <Computers state={state} />
    {here?.local === false ? <>
      <SettingsGroupTitle>{t('Let other devices connect')}</SettingsGroupTitle>
      <p className="muted text-muted-foreground small text-caption m-[0_0_12px]">{t('You are looking at {0}. Who can connect to a computer is set on that computer.', { 0: here.name })}</p>
    </> : <ThisComputer />}
  </div>
}

function ThisComputer() {
  const invoke = useSettingsInvoke()
  const [status, setStatus, reload] = useNetworkStatus(2500)
  const [host, setHost] = useState(ALL_NETWORKS), [port, setPort] = useState(String(DEFAULT_PORT)), [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false), [pairing, setPairing] = useState(false), [revoking, setRevoking] = useState<string | null>(null)
  const loaded = useRef(false)
  // Take the saved choice once; later polls must not overwrite what the user is typing.
  useEffect(() => { if (status && !loaded.current) { loaded.current = true; setHost(status.host); setPort(String(status.port)) } }, [status])
  if (!status) return null
  const managed = status.source === 'command-line'
  const portNumber = Number(port)
  const portValid = Number.isInteger(portNumber) && portNumber >= 1024 && portNumber <= 65535
  const changed = status.enabled && (host !== status.host || portNumber !== status.port)
  const options = [{ value: ALL_NETWORKS, label: t('All networks') }, ...status.addresses.map((entry) => ({ value: entry.address, label: `${entry.name} · ${entry.address}` }))]
  if (!options.some((option) => option.value === host)) options.push({ value: host, label: host })
  const apply = async (enabled: boolean) => {
    setBusy(true)
    try { setStatus(await invoke('network.configure', { enabled, host, port: portNumber, acceptUnencrypted: true })) }
    catch (error) { notifyError(errorText(error), t('Remote access')) }
    finally { setBusy(false) }
  }
  const revoke = async (id: string) => { try { setStatus(await invoke('network.revoke', id)) } catch (error) { notifyError(errorText(error), t('Remote access')) } }
  const listening = status.listening ? `${status.tls ? 'https' : 'http'}://${status.host}:${status.port}` : null
  return <>
    <SettingsGroupTitle>{t('Let other devices connect')}</SettingsGroupTitle>
    <SettingsRow className="settings-toggle">
      <SettingsLabel title={t('Allow other devices')} help={managed ? t('Set when Ramu was started with --listen. Change it there.') : t('Phones and other computers can use this computer’s chats, files and terminals after you pair them.')} />
      <Switch aria-label={t('Allow other devices')} checked={status.enabled} disabled={busy || managed || (!status.enabled && !portValid)} onCheckedChange={(checked) => { if (!checked || status.tls || /^(127\.|::1$)/.test(host)) void apply(checked); else setConfirm(true) }} />
    </SettingsRow>
    {!managed && <>
      <SettingsRow>
        <SettingsLabel title={t('Network')} help={t('Choose your VPN address (Tailscale, NetBird, ZeroTier, WireGuard) to keep Ramu off other networks.')} />
        <Dropdown label={t('Network')} value={host} options={options} onChange={setHost} disabled={busy} />
      </SettingsRow>
      <SettingsRow>
        <SettingsLabel title={t('Port')} help={portValid ? undefined : t('Use a number from 1024 to 65535.')} />
        <Input aria-label={t('Port')} inputMode="numeric" value={port} aria-invalid={!portValid} disabled={busy} onChange={(event) => setPort(event.target.value.replace(/\D/g, '').slice(0, 5))} />
      </SettingsRow>
    </>}
    {(changed && !managed) && <div className="flex justify-end pb-3"><Button variant="default" disabled={busy || !portValid} onClick={() => void apply(true)}>{t('Apply')}</Button></div>}
    {status.enabled && <p className="muted text-muted-foreground small text-caption m-[0_0_12px]" role="status">{listening ? t('Listening on {0}', { 0: listening.replace(/^https?:\/\//, '') }) : status.error ? t('Cannot listen on {0}:{1} ({2}). Local use is unaffected; Ramu keeps retrying.', { 0: status.host, 1: status.port, 2: status.error }) : t('Starting…')}</p>}
    {!status.tls && status.enabled && !/^(127\.|::1$)/.test(status.host) && <p className="muted text-muted-foreground small text-caption m-[0_0_12px]">{t('Ramu does not encrypt this connection. Use it on a VPN or a network you trust.')}</p>}

    <SettingsGroupTitle className="mt-5">{t('Devices that can use this computer')}</SettingsGroupTitle>
    <SettingsRow>
      <SettingsLabel title={t('Pair a device')} help={status.listening ? t('Creates a one-time code for a phone or another computer. Enter it on that device.') : t('Turn on access above first.')} />
      <Button variant="secondary" className="bg-fill hover:bg-fill-hover" disabled={!status.listening} onClick={() => setPairing(true)}><Link2 size={14} />{t('Pair a device…')}</Button>
    </SettingsRow>
    {status.devices.map((device) => <SettingsRow key={device.id}>
      <SettingsLabel title={device.name} help={t('Paired {0} · last seen {1}', { 0: new Date(device.createdAt).toLocaleDateString(), 1: device.lastSeenAt ? timeAgo(device.lastSeenAt) : t('never') })} />
      <Button variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={() => setRevoking(device.id)}>{t('Revoke')}</Button>
    </SettingsRow>)}
    {!status.devices.length && <p className="muted text-muted-foreground small text-caption m-[0_0_12px]">{t('No devices paired yet.')}</p>}

    {confirm && <ConfirmDialog title={t('Allow other devices?')} confirmLabel={t('Turn on')} onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void apply(true) }}>
      <p>{t('Ramu does not encrypt this connection. Anyone on that network could read what a paired device sends. Turn it on only for a VPN such as Tailscale, NetBird or ZeroTier, or a network you trust. Devices still need a pairing code.')}</p>
    </ConfirmDialog>}
    {revoking !== null && <ConfirmDialog danger title={t('Revoke {0}?', { 0: status.devices.find((device) => device.id === revoking)?.name ?? '' })} confirmLabel={t('Revoke')} onCancel={() => setRevoking(null)} onConfirm={() => { if (revoking) void revoke(revoking); setRevoking(null) }}>
      <p>{t('It stops working right away and has to be paired again to reconnect.')}</p>
    </ConfirmDialog>}
    {pairing && <PairDialog known={status.devices.map((device) => device.id)} onClose={() => { setPairing(false); void reload() }} />}
  </>
}

function PairDialog({ known, onClose }: { known: string[]; onClose: () => void }) {
  const invoke = useSettingsInvoke()
  const [offer, setOffer] = useState<PairingOffer | null>(null), [now, setNow] = useState(Date.now()), [error, setError] = useState<string | null>(null)
  const [qr, setQr] = useState('')
  const [qrUrl, setQrUrl] = useState('')
  useEffect(() => { let alive = true; setQr(''); if (offer && offer.urls.length) { const url = qrUrl || offer.urls[0]!.url; void QRCode.toDataURL(encodePairQr({ url, code: offer.code, expiresAt: offer.expiresAt }), { width: 240, margin: 2 }).then(value => { if (alive) setQr(value) }, () => {}) }; return () => { alive = false } }, [offer, qrUrl])
  const [joined, setJoined] = useState<string | null>(null), [showOther, setShowOther] = useState(false)
  const [status] = useNetworkStatus(1500)
  const create = useCallback(() => { setError(null); setJoined(null); invoke('network.pair').then(setOffer, (e) => setError(errorText(e))) }, [])
  useEffect(create, [create])
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id) }, [])
  const arrived = status?.devices.find((device) => !known.includes(device.id))
  useEffect(() => { if (arrived) setJoined(arrived.name) }, [arrived])
  const expired = !!offer && offer.expiresAt <= now
  // IPv4 first: they are shorter and what people type. Link-local and loopback are already left out.
  const sorted = offer ? [...offer.urls].sort((a, b) => Number(a.url.includes('[')) - Number(b.url.includes('['))) : []
  const likely = sorted.filter((entry) => !VIRTUAL_INTERFACE.test(entry.interface)), other = sorted.filter((entry) => VIRTUAL_INTERFACE.test(entry.interface))
  const urls = showOther || !likely.length ? sorted : likely
  const hidden = sorted.length - urls.length
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="max-w-[520px]" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{joined ? t('{0} is paired', { 0: joined }) : t('Pair a device')}</DialogTitle>{!joined && <DialogDescription>{t('On the other device open Ramu, go to Settings → Remote access → Connect to a computer, then enter one of these addresses and the code.')}</DialogDescription>}</DialogHeader>
      {error && <p className="text-bad small text-caption" role="alert">{error}</p>}
      {joined ? <p className="muted text-muted-foreground">{t('It can now use this computer. You can revoke it any time from Devices that can use this computer.')}</p> : offer && <>
        <div className="flex items-center justify-between gap-3 rounded-(--radius-m) bg-fill p-[14px_16px]">
          <div><span className="sr-only">{t('Pairing code')}</span><div className={`font-mono text-[28px] font-semibold tracking-[0.12em] ${expired ? 'text-muted-foreground line-through' : ''}`}>{offer.code}</div><div className="muted text-muted-foreground small text-caption">{expired ? t('Expired') : t('Works once · expires in {0}', { 0: countdown(offer.expiresAt, now) })}</div></div>
          {expired ? <Button variant="secondary" onClick={create}>{t('New code')}</Button> : <CopyButton text={offer.code} label={t('Copy code')} />}
        </div>
        {!expired && offer.urls.length > 0 && <div className="flex items-center gap-2 rounded-(--radius-s) bg-fill p-[4px_6px_4px_12px]"><Link2 size={14} className="flex-none text-muted-foreground" aria-hidden /><span className="grow flex-1 min-w-0 truncate text-control">{t('Pairing link')}</span><span className="muted text-muted-foreground small text-caption flex-none">{t('Open it on a device that has Ramu')}</span><CopyButton text={encodePairLink({ url: qrUrl || offer.urls[0]!.url, code: offer.code, expiresAt: offer.expiresAt })} label={t('Copy pairing link')} /></div>}
        {qr && !expired && <div className="flex flex-col items-center gap-2"><img src={qr} width={240} height={240} alt="Scan this pairing offer with Ramu on your phone" /><Dropdown label={t('QR host address')} value={qrUrl || offer.urls[0]!.url} options={offer.urls.map((entry) => ({ value: entry.url, label: entry.url }))} onChange={setQrUrl} /></div>}
        <div className="flex flex-col gap-1">
          <span className="muted text-muted-foreground small text-caption">{t('Addresses this computer has')}</span>
          {urls.length ? urls.map((entry) => <div key={entry.url} className="flex items-center gap-2 rounded-(--radius-s) bg-fill p-[4px_6px_4px_12px]"><code className="font-mono text-control grow flex-1 min-w-0 truncate">{entry.url}</code><span className="muted text-muted-foreground small text-caption flex-none">{entry.interface}</span><CopyButton text={entry.url} label={t('Copy address')} /></div>) : <p className="muted text-muted-foreground small text-caption">{t('No network address found. Connect this computer to a network or VPN.')}</p>}
          {hidden > 0 && <Button variant="ghost" className="self-start" onClick={() => setShowOther(true)}>{t('Show {0} more (Docker, VM and other virtual networks)', { 0: other.length })}</Button>}
        </div>
      </>}
      <DialogFooter><Button variant={joined ? 'default' : 'secondary'} className={joined ? undefined : 'bg-fill hover:bg-fill-hover'} onClick={onClose}>{joined ? t('Done') : t('Close')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

function Computers({ state }: { state: ComputerList }) {
  useLanguage()
  const [busy, setBusy] = useState(false)
  const [address, setAddress] = useState(''), [code, setCode] = useState(''), [name, setName] = useState('')
  const [adding, setAdding] = useState(false), [editing, setEditing] = useState<string | null>(null)
  const [mode, setMode] = useState<'link' | 'ssh'>('link'), [link, setLink] = useState(''), [linkError, setLinkError] = useState<string | null>(null)
  const [target, setTarget] = useState(''), [hosts, setHosts] = useState<string[]>([])
  const [forgetting, setForgetting] = useState<string | null>(null)
  const others = state.computers.filter((computer) => !computer.local)
  const selected = state.computers.find((computer) => computer.id === editing)
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn() } catch (error) { notifyError(errorText(error), t('Computers')) } finally { setBusy(false) } }
  const pair = () => act(async () => { await invoke('computers.pair', address, code, name.trim() || undefined); reset(); setAdding(false) })
  const repair = (computer: Computer) => { setMode('link'); setLink(''); setLinkError(null); setAddress(computer.url ?? ''); setName(computer.name); setCode(''); setAdding(true) }
  const reset = () => { setAddress(''); setCode(''); setName(''); setLink(''); setLinkError(null); setTarget('') }
  const choose = (next: 'link' | 'ssh') => { setMode(next); if (next === 'ssh' && !hosts.length) void invoke('computers.sshHosts').then(setHosts, () => {}) }
  // A pasted link or address fills the fields below; they stay editable.
  const fromLink = (text: string) => {
    setLink(text)
    if (!text.trim()) { setLinkError(null); return }
    try {
      const parsed = parsePairInput(text)
      setAddress(parsed.url); if (parsed.code) setCode(parsed.code); if (parsed.name) setName((current) => current || parsed.name!)
      setLinkError(null)
    } catch (error) { setLinkError(errorText(error)) }
  }
  // A pairing link opened from outside the app arrives while this screen is showing, or just before it does.
  useEffect(() => {
    const show = () => { const incoming = takePairLink(); if (incoming) { setAdding(true); setMode('link'); fromLink(incoming) } }
    show()
    return onPairLink(show)
  }, [])
  const connectSsh = () => act(async () => { await invoke('computers.pairSsh', target.trim(), name.trim() || undefined); reset(); setAdding(false) })
  return <section className="computer-management mb-7" aria-label={t('Computers')}>
    <div className="flex items-center justify-between gap-3 mb-3">
      <div><SettingsGroupTitle className="mb-1">{t('Connect to a computer')}</SettingsGroupTitle><p className="m-0 text-caption text-muted-foreground">{t('{0} connected · {1} saved', { 0: state.computers.filter((computer) => computer.status === 'connected').length, 1: state.computers.length })}</p></div>
      {others.length > 0 && !adding && <Button variant="secondary" disabled={busy} onClick={() => { setAdding(true); reset() }}><Plus size={14} />{t('Add a computer')}</Button>}
    </div>
    <p className="m-[0_0_12px] text-caption text-muted-foreground">{t('Each computer keeps its own projects, chats and settings. Switching only changes the workspace you see.')}</p>
    <div className="flex flex-col gap-2">
      {state.computers.map((computer) => <article key={computer.id} className={`computer-card rounded-(--radius-m) p-3 ${computer.id === state.current ? 'bg-primary/10' : 'bg-fill'}`} aria-label={computer.name}>
        <div className="flex items-start gap-3">
          <span className="flex size-8 flex-none items-center justify-center rounded-(--radius-s) bg-hover text-muted-foreground">{computer.local ? <Monitor size={16} /> : computer.ssh ? <Terminal size={16} /> : <Network size={16} />}</span>
          <div className="min-w-0 grow">
            <div className="flex items-center gap-2"><strong className="truncate text-body font-medium">{computer.name}</strong><span className="text-caption text-muted-foreground">{computer.local ? t('Local') : computer.ssh ? t('SSH') : t('Remote')}</span>{computer.id === state.current && <span className="ml-auto flex-none rounded-full bg-primary/10 px-2 py-0.5 text-caption text-(--accent)">{t('Showing')}</span>}</div>
            <p className="m-[3px_0_0] truncate text-caption text-muted-foreground" title={computer.ssh ?? computer.url ?? state.deviceName}>{computer.ssh ? `ssh ${computer.ssh}` : computer.url ?? state.deviceName}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 text-caption text-muted-foreground"><StatusDot status={computer.status} /><span>{activityText(computer) || statusText(computer.status)}</span></span>
          <div className="flex flex-none items-center gap-1">
            {computer.id !== state.current && (computer.local || computer.status === 'connected') && <Button variant="secondary" disabled={busy} onClick={() => void act(() => invoke('computers.open', computer.id))}>{t('Open')}</Button>}
            {!computer.local && computer.status === 'paused' && <Button variant="secondary" disabled={busy} onClick={() => void act(() => invoke('computers.update', computer.id, { enabled: true }))}>{t('Resume')}</Button>}
            {!computer.local && computer.status === 'offline' && <Button variant="secondary" disabled={busy} onClick={() => void act(() => invoke('computers.retry', computer.id))}>{t('Retry')}</Button>}
            {!computer.local && computer.status === 'rejected' && <Button variant="secondary" disabled={busy} onClick={() => repair(computer)}>{t('Pair again')}</Button>}
            {!computer.local && <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={t('Manage {0}', { 0: computer.name })} title={t('Connection settings')} onClick={() => setEditing(computer.id)}><Settings2 size={14} /></Button>}
            {!computer.local && <Button variant="ghost" disabled={busy} onClick={() => setForgetting(computer.id)}>{t('Forget')}</Button>}
          </div>
        </div>
      </article>)}
    </div>
    {!others.length && <p className="mt-3 text-caption text-muted-foreground">{t('Add your laptop, workstation or server. They stay connected together while Ramu is open.')}</p>}
    {(adding || !others.length) && <div className="mt-3 rounded-(--radius-m) bg-fill p-4">
      <div className="flex items-center justify-between gap-2 mb-2"><strong className="text-body font-medium">{t('Add a computer')}</strong>{others.length > 0 && <Button variant="ghost" disabled={busy} onClick={() => setAdding(false)}>{t('Cancel')}</Button>}</div>
      <div className="mb-4 inline-flex gap-1 rounded-(--radius-s) bg-background/40 p-0.5" role="group" aria-label={t('How to connect')}>
        <Button variant="ghost" size="sm" aria-pressed={mode === 'link'} className={mode === 'link' ? 'bg-hover' : ''} disabled={busy} onClick={() => choose('link')}><Link2 size={14} />{t('Link or address')}</Button>
        <Button variant="ghost" size="sm" aria-pressed={mode === 'ssh'} className={mode === 'ssh' ? 'bg-hover' : ''} disabled={busy} onClick={() => choose('ssh')}><Terminal size={14} />{t('SSH')}</Button>
      </div>
      {mode === 'link' ? <>
        <p className="m-[0_0_12px] text-caption text-muted-foreground">{t('Open Remote access on that computer, choose Pair a device, then paste its link or enter what it shows. Projects live on that computer, so add them there.')}</p>
        <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); if (!busy && address.trim() && code.trim()) void pair() }}>
          <Input className="bg-background" aria-label={t('Pairing link')} placeholder={t('Paste a pairing link (ramu://pair…) or a remote link')} value={link} disabled={busy} aria-invalid={!!linkError} onChange={(event) => fromLink(event.target.value)} />
          {linkError && <p className="m-0 text-caption text-bad" role="alert">{linkError}</p>}
          <Input className="bg-background" aria-label={t('Address')} placeholder={t('Address, for example 100.64.0.7:7788')} value={address} disabled={busy} onChange={(event) => setAddress(event.target.value)} />
          <div className="grid grid-cols-2 gap-2"><Input className="bg-background" aria-label={t('Pairing code')} placeholder={t('Pairing code')} autoCapitalize="characters" spellCheck={false} value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} /><Input className="bg-background" aria-label={t('Name')} placeholder={t('Name (optional)')} maxLength={60} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></div>
          <div className="flex justify-end"><Button type="submit" variant="default" disabled={busy || !address.trim() || !code.trim()}>{busy ? t('Pairing…') : t('Pair')}</Button></div>
        </form>
      </> : <>
        <p className="m-[0_0_12px] text-caption text-muted-foreground">{t('Connects through SSH with your keys and ~/.ssh/config. Ramu must already be installed on that computer; it is started there if it is not running, and no port is opened to the network.')}</p>
        <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); if (!busy && target.trim()) void connectSsh() }}>
          <Input className="bg-background" aria-label={t('SSH host')} placeholder={t('user@host or an alias from your SSH config')} autoCapitalize="none" spellCheck={false} value={target} disabled={busy} onChange={(event) => setTarget(event.target.value)} />
          {hosts.length > 0 && <Dropdown label={t('SSH config aliases')} value="" placeholder={t('Choose from your SSH config')} options={hosts.map((host) => ({ value: host, label: host }))} onChange={setTarget} disabled={busy} />}
          <Input className="bg-background" aria-label={t('Name')} placeholder={t('Name (optional)')} maxLength={60} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
          <div className="flex justify-end"><Button type="submit" variant="default" disabled={busy || !target.trim()}>{busy ? t('Connecting…') : t('Connect')}</Button></div>
        </form>
      </>}
    </div>}
    {selected && <ComputerSettings key={selected.id} computer={selected} onClose={() => setEditing(null)} />}
    {forgetting !== null && <ConfirmDialog danger title={t('Forget {0}?', { 0: others.find((computer) => computer.id === forgetting)?.name ?? '' })} confirmLabel={t('Forget')} onCancel={() => setForgetting(null)} onConfirm={() => { const id = forgetting; setForgetting(null); if (id) void act(() => invoke('computers.forget', id)) }}>
      <p>{forgetting === state.current ? t('You are looking at it now, so Ramu goes back to this computer. You can pair again later.') : t('You can pair again later. The other computer still lists this device until you revoke it there.')}</p>
    </ConfirmDialog>}
  </section>
}

function ComputerSettings({ computer, onClose }: { computer: Computer; onClose: () => void }) {
  const [name, setName] = useState(computer.name), [enabled, setEnabled] = useState(computer.enabled !== false)
  const [retryMode, setRetryMode] = useState(computer.retryMode ?? 'events'), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const save = async () => {
    setBusy(true); setError(null)
    try { await invoke('computers.update', computer.id, { name: name.trim(), enabled, retryMode }); onClose() }
    catch (cause) { setError(errorText(cause)); setBusy(false) }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-w-[540px]">
      <DialogHeader><DialogTitle>{t('Connection settings')}</DialogTitle><DialogDescription>{t('Saved on this device. The other computer’s projects and settings stay as they are.')}</DialogDescription></DialogHeader>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-caption text-muted-foreground">{t('Name')}<Input aria-label={t('Computer name')} maxLength={60} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
        <div className="rounded-(--radius-s) bg-fill px-3 py-2"><div className="flex items-center gap-2"><code className="min-w-0 grow truncate text-caption" title={computer.url ?? ''}>{computer.url}</code><CopyButton text={computer.url ?? ''} label={t('Copy address')} /></div><p className="m-0 text-caption text-muted-foreground">{computer.url?.startsWith('https:') ? t('HTTPS connection') : t('HTTP · use a VPN or trusted network')}{computer.pairedAt ? ` · ${t('Paired {0}', { 0: new Date(computer.pairedAt).toLocaleDateString() })}` : ''}</p></div>
        <div className="flex items-center justify-between gap-4"><span><strong className="text-body font-medium">{t('Keep connected')}</strong><span className="block mt-1 text-caption text-muted-foreground">{t('Turn off to pause this connection without forgetting it. No retries or announcements are used while paused.')}</span></span><Switch aria-label={t('Keep connected')} checked={enabled} disabled={busy} onCheckedChange={setEnabled} /></div>
        <div className="flex items-center justify-between gap-4"><span className="text-body">{t('Reconnect')}</span><Dropdown label={t('Reconnect')} value={retryMode} disabled={busy || !enabled} options={[{ value: 'events', label: t('When the network or host returns') }, { value: 'periodic', label: t('Also check every five minutes') }]} onChange={(value) => setRetryMode(value as 'events' | 'periodic')} /></div>
        <p className="m-0 text-caption text-muted-foreground">{retryMode === 'events' ? t('Waits for a network change, waking from sleep, a signed host announcement, or Retry. No periodic connection checks.') : t('Uses the same wake-up signals and a quiet five-minute check if an announcement cannot reach this device.')}</p>
        <p className="m-0 text-caption text-muted-foreground">{t('Host announcements need a reachable LAN or VPN path. If your network blocks them, use Retry or enable five-minute checks.')}</p>
        {error && <p role="alert" className="m-0 text-caption text-bad">{error}</p>}
      </div>
      <DialogFooter><Button variant="secondary" disabled={busy} onClick={onClose}>{t('Cancel')}</Button><Button variant="default" disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? t('Saving…') : t('Save')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
