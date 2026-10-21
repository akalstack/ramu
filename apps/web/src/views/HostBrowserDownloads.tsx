import { useEffect, useState } from 'react'
import type { BrowserDownloadInfo } from '@ramu/shared/browserBridge'
import { useHost } from '../workspace/HostProvider'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { t } from '../i18n'
import { errorText } from '../lib/errors'

export function HostBrowserDownloads({ taskId, tabId, own }: { taskId: string; tabId?: string; own: boolean }) {
  const host = useHost()
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<BrowserDownloadInfo[]>([])
  const [paths, setPaths] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try { const entries = await host.invoke('hostBrowser.downloads', taskId); if (active) setEntries(entries) }
      catch (error) { if (active) setMessage(t(errorText(error))) }
      finally { if (active) timer = setTimeout(() => void refresh(), 1000) }
    }
    void refresh()
    return () => { active = false; clearTimeout(timer) }
  }, [host, taskId, open])
  const act = async (work: () => Promise<unknown>, success = '') => {
    setBusy(true); setMessage('')
    try { await work(); setMessage(success) } catch (error) { setMessage(t(errorText(error))) }
    finally { setBusy(false) }
  }
  return <details className="border-b border-(--line) px-3 py-1 text-caption" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer">{t('Downloads')}</summary>
    <div className="max-h-48 space-y-2 overflow-auto py-2">
      <p className="text-muted-foreground">{t('Downloads stay on the execution host. Save into a new relative workspace file; existing files are never overwritten.')}</p>
      <Button size="sm" variant="secondary" disabled={!own || !tabId || busy} onClick={() => tabId && void act(() => host.invoke('hostBrowser.allowDownload', taskId, tabId), t('Next download allowed for 60 seconds.'))}>{t('Allow next download')}</Button>
      {entries.map(entry => <div key={entry.id} className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate" title={entry.name}>{entry.name} · {t(entry.state)} · {Math.ceil(entry.received / 1024)} KiB</span>
        {entry.state === 'completed' && <>
          <Input aria-label={t('Save to workspace path')} value={paths[entry.id] ?? entry.name} maxLength={4000} onChange={event => setPaths(paths => ({ ...paths, [entry.id]: event.target.value }))}/>
          <Button size="sm" disabled={busy} onClick={() => void act(() => host.invoke('hostBrowser.saveDownload', taskId, entry.id, paths[entry.id] ?? entry.name), t('Saved to the thread workspace.'))}>{t('Save')}</Button>
        </>}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => host.invoke('hostBrowser.cancelDownload', taskId, entry.id))}>{entry.state === 'progressing' ? t('Cancel') : t('Remove')}</Button>
      </div>)}
      {message && <p role="status">{message}</p>}
    </div>
  </details>
}
