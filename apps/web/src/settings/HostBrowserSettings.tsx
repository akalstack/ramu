import { useCallback, useEffect, useState } from 'react'
import type { NetworkDevice, Task } from '@ramu/shared/types'
import type { BrowserProfileCatalog } from '@ramu/shared/types/browser'
import type { RamuMethods } from '@ramu/shared/api'
import { invokeOn, ramu } from '../ipc'
import { ownHostId } from '../hosts'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SettingsGroupTitle } from '@/components/settings-row'
import { Dropdown } from '../Menu'

/** Setup and explicit device grants are administered on the runtime's owning host. */
export function HostBrowserSettings({ hostId, refreshed, onRemoved }: { hostId: string; refreshed(): Promise<void>; onRemoved(id: string): void }) {
  const [status, setStatus] = useState<ReturnType<RamuMethods['hostBrowser.status']> | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [devices, setDevices] = useState<NetworkDevice[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [grants, setGrants] = useState<ReturnType<RamuMethods['hostBrowser.grants']>>([])
  const [profiles, setProfiles] = useState<BrowserProfileCatalog | null>(null)
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState('')
  const [rename, setRename] = useState('')
  const [device, setDevice] = useState('')
  const [task, setTask] = useState('')
  const [review, setReview] = useState<ReturnType<RamuMethods['hostBrowser.profileReview']> | null>(null)
  const local = hostId === ownHostId()
  const refresh = useCallback(async () => {
    const status = await invokeOn(hostId, 'hostBrowser.status')
    setStatus(status)
    if (local && status.enabled) {
      const [network, tasks, grants, profiles] = await Promise.all([
        ramu.invoke('network.status'), invokeOn(hostId, 'tasks.list'), invokeOn(hostId, 'hostBrowser.grants'), invokeOn(hostId, 'hostBrowser.profiles'),
      ])
      setDevices(network.devices.filter(device => device.role !== 'viewer'))
      setTasks(tasks.toSorted((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, 200)); setGrants(grants); setProfiles(profiles)
    }
  }, [hostId, local])
  useEffect(() => { let active = true; void refresh().catch(error => { if (active) setError(t(errorText(error))) }); return () => { active = false } }, [refresh])
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await work(); await refresh(); await refreshed() } catch (error) { setError(t(errorText(error))) }
    finally { setBusy(false) }
  }
  return <div className="space-y-3">
    <SettingsGroupTitle>{t('Host browser & remote viewing')}</SettingsGroupTitle>
    <p className="text-caption text-muted-foreground">{t('Setup downloads compatible Chromium when needed and checks its sandbox. It runs on the execution host with separate website sign-ins. Setup and device grants require review on the owning host.')}</p>
    {status?.reason && <p role="status" className="text-caption">{t(status.reason)}</p>}
    {error && <p role="alert" className="text-caption">{error}</p>}
    <div className="flex gap-2">
      <Button variant="secondary" size="sm" disabled={busy || !local} onClick={() => void act(() => invokeOn(hostId, 'hostBrowser.setup'))}>{status?.available ? t('Ready') : t('Set up host browser')}</Button>
      {status?.enabled && <Button variant="ghost" size="sm" disabled={busy || !local} onClick={() => void act(() => invokeOn(hostId, 'hostBrowser.disable'))}>{t('Stop host browser')}</Button>}
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act(async () => {})}>{t('Refresh')}</Button>
    </div>
    {local && status?.available && <>
      <p className="text-caption text-muted-foreground">{t('Grant this paired owner device one hour of viewing, control and scoped file transfers for one thread. Pairing alone is insufficient. Viewer devices cannot receive this grant.')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Dropdown label={t('Device')} value={device} options={devices.map(device => ({ value: device.id, label: device.name }))} onChange={setDevice}/>
        <Dropdown label={t('Thread')} value={task} options={tasks.map(task => ({ value: task.id, label: task.title }))} onChange={setTask}/>
        <Button size="sm" disabled={busy || !device || !task} onClick={() => void act(() => invokeOn(hostId, 'hostBrowser.grant', device, task))}>{t('Grant browser access')}</Button>
      </div>
      {grants.map(grant => <div key={`${grant.device}:${grant.thread}`} className="flex items-center gap-2 text-caption">
        <span className="min-w-0 flex-1 truncate">{devices.find(device => device.id === grant.device)?.name ?? grant.device} · {tasks.find(task => task.id === grant.thread)?.title ?? grant.thread} · {new Date(grant.expires).toLocaleTimeString()}</span>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => invokeOn(hostId, 'hostBrowser.revoke', grant.device, grant.thread))}>{t('Revoke')}</Button>
      </div>)}
      <p className="text-caption text-muted-foreground">{t('Host browser profiles')}</p>
      <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void act(async () => { await invokeOn(hostId, 'hostBrowser.profileCreate', name); setName('') }) }}>
        <Input aria-label={t('Profile name')} value={name} maxLength={80} onChange={event => setName(event.target.value)}/>
        <Button size="sm" disabled={busy || !name.trim()}>{t('Add profile')}</Button>
      </form>
      {profiles?.profiles.filter(profile => !profile.temporary).map(profile => <div key={profile.id} className="flex items-center gap-2 text-caption">
        <span className="flex-1">{profile.builtin ? t(profile.name) : profile.name}</span>
        {!profile.builtin && (renaming === profile.id ? <form className="flex gap-1" onSubmit={event => { event.preventDefault(); void act(async () => { await invokeOn(hostId, 'hostBrowser.profileRename', profile.id, rename); setRenaming('') }) }}>
          <Input aria-label={t('Profile name')} maxLength={80} value={rename} onChange={event => setRename(event.target.value)}/>
          <Button size="sm" disabled={busy || !rename.trim()}>{t('Save')}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming('')}>{t('Cancel')}</Button>
        </form> : <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setRenaming(profile.id); setRename(profile.name) }}>{t('Rename')}</Button>)}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(async () => setReview(await invokeOn(hostId, 'hostBrowser.profileReview', profile.id, false)))}>{t('Clear website data')}</Button>
        {!profile.builtin && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(async () => setReview(await invokeOn(hostId, 'hostBrowser.profileReview', profile.id, true)))}>{t('Delete profile')}</Button>}
      </div>)}
    </>}
    <Dialog open={!!review} onOpenChange={open => { if (!open) setReview(null) }}>
      <DialogContent><DialogHeader><DialogTitle>{review?.remove ? t('Delete profile') : t('Clear website data')}</DialogTitle>
        <DialogDescription>{review && t('This closes {0} tabs and signs out websites in this profile. Deleting a selected profile restores Default. This cannot be undone.', { 0: review.tabs })} {review?.name}</DialogDescription>
      </DialogHeader><Button variant="secondary" disabled={busy} onClick={() => setReview(null)}>{t('Cancel')}</Button>
      <Button disabled={busy} onClick={() => review && void act(async () => { await invokeOn(hostId, 'hostBrowser.profileConfirm', review.token); if (review.remove) onRemoved(review.id); setReview(null) })}>{t('Confirm')}</Button></DialogContent>
    </Dialog>
  </div>
}
