import { useEffect, useState, type ReactNode } from 'react'
import { Link2, Radar } from 'lucide-react'
import { parsePairInput } from '@ramu/contracts'
import type { Computer } from '@ramu/shared/types'
import { isSshTarget } from '@ramu/shared/hostTarget'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { DIALOG_SCROLLS, DialogScrollBody } from '@/components/dialog-scroll-body'
import { Dropdown } from '../../Menu'
import { invoke, ramu } from '../../ipc'
import { errorText } from '../../lib/errors'
import { t, useLanguage } from '../../i18n'
import { NearbyHosts } from '../NearbyHosts'

type AddMode = 'nearby' | 'address'

/**
 * Adding a host: hosts nearby, or one field that takes a pairing link, an address or an SSH host and asks only for what
 * that needs.
 */
export function AddHostDialog({ link, repair, onClose }: { link?: string; repair?: Computer; onClose: () => void }) {
  useLanguage()
  const [mode, setMode] = useState<AddMode>(link || repair ? 'address' : 'nearby')
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState(link ?? repair?.url ?? '')
  const [address, setAddress] = useState(repair?.url ?? ''),
    [alternates, setAlternates] = useState<string[]>([]),
    [code, setCode] = useState(''),
    [name, setName] = useState(repair?.name ?? '')
  const [focusCode, setFocusCode] = useState(!!repair)
  const [aliases, setAliases] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  // Asking a host to pair: the number to match once it answers.
  const [asking, setAsking] = useState<{ name: string; code: string | null } | null>(null)
  useEffect(
    () => ramu.on('computers:pairCode', ({ code }) => setAsking((current) => current && { ...current, code })),
    [],
  )
  useEffect(() => {
    void invoke('computers.sshHosts').then(setAliases, () => {})
  }, [])
  const ssh = isSshTarget(text, aliases)
  // A pasted link or address fills the code and name; they stay editable.
  const read = (value: string) => {
    setText(value)
    setError(null)
    setAlternates([])
    if (!value.trim() || isSshTarget(value, aliases)) return setAddress('')
    try {
      const parsed = parsePairInput(value)
      setAddress(parsed.url)
      setAlternates(parsed.alternates ?? [])
      if (parsed.code) setCode(parsed.code)
      if (parsed.name) setName((current) => current || parsed.name!)
    } catch (reason) {
      setAddress('')
      setError(errorText(reason))
    }
  }
  useEffect(() => {
    if (link) read(link)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the link the dialog opened with, once
  }, [])
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      onClose()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const ask = (host: string, request: () => Promise<unknown>, fallback?: () => void) => {
    setAsking({ name: host, code: null })
    void request()
      .then(onClose)
      .catch((reason) => {
        setAsking(null)
        const message = errorText(reason)
        if (/cancelled|aborted/i.test(message)) return
        // The address form, filled in, is the next step whatever stopped the request.
        fallback?.()
        setError(message)
      })
  }
  const submit = () => {
    if (busy) return
    if (ssh) void run(() => invoke('computers.pairSsh', text.trim(), name.trim() || undefined))
    else if (address && code.trim())
      void run(() => invoke('computers.pair', address, code.trim(), name.trim() || undefined, alternates))
  }
  const tabs: { mode: AddMode; label: string; icon: ReactNode }[] = [
    { mode: 'nearby', label: t('Nearby'), icon: <Radar size={14} /> },
    { mode: 'address', label: t('Link, address or SSH'), icon: <Link2 size={14} /> },
  ]
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) {
          if (asking) void Promise.resolve(invoke('computers.cancelPairRequest')).catch(() => {})
          onClose()
        }
      }}
    >
      <DialogContent className={`${DIALOG_SCROLLS} sm:max-w-[540px]`}>
        <DialogHeader>
          <DialogTitle>{repair ? t('Pair {0} again', { 0: repair.name }) : t('Add a host')}</DialogTitle>
          <DialogDescription>
            {t('Its projects, agents and terminals stay on that host. This computer opens and controls them.')}
          </DialogDescription>
        </DialogHeader>
        <DialogScrollBody>
          <div className="inline-flex gap-1 self-start rounded-(--radius-s) bg-fill p-0.5" role="group">
            {tabs.map((tab) => (
              <Button
                key={tab.mode}
                variant="ghost"
                size="sm"
                aria-pressed={mode === tab.mode}
                className={mode === tab.mode ? 'bg-hover text-foreground' : 'text-muted-foreground'}
                disabled={busy || !!asking}
                onClick={() => {
                  setMode(tab.mode)
                  setError(null)
                }}
              >
                {tab.icon}
                {tab.label}
              </Button>
            ))}
          </div>
          {asking ? (
            <div role="status" className="flex flex-col items-start gap-2 rounded-(--radius-m) bg-fill p-[14px_16px]">
              {asking.code ? (
                <>
                  <span className="text-control">
                    {t('Allow this computer on {0} if it shows this number', { 0: asking.name })}
                  </span>
                  <span className="font-mono text-[28px] font-semibold tracking-[0.12em]">{asking.code}</span>
                </>
              ) : (
                <span className="text-control">{t('Asking {0}…', { 0: asking.name })}</span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAsking(null)
                  void Promise.resolve(invoke('computers.cancelPairRequest')).catch(() => {})
                }}
              >
                {t('Cancel')}
              </Button>
            </div>
          ) : mode === 'nearby' ? (
            <NearbyHosts
              onFallback={() => setMode('address')}
              onChoose={(host, url) =>
                ask(
                  host.name,
                  () => Promise.resolve(invoke('computers.pairByRequest', url, host.name)),
                  () => {
                    setMode('address')
                    setText(url)
                    setAddress(url)
                    setName((current) => current || host.name)
                    setCode('')
                    setFocusCode(true)
                  },
                )
              }
            />
          ) : (
            <form
              id="add-host"
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                submit()
              }}
            >
              <Input
                aria-label={t('Link, address or SSH host')}
                placeholder={t('Pairing link, 100.64.0.7:7788 or user@host')}
                autoFocus={!focusCode}
                autoCapitalize="none"
                spellCheck={false}
                value={text}
                disabled={busy}
                aria-invalid={!!error && !ssh && !address}
                onChange={(event) => read(event.target.value)}
              />
              {aliases.length > 0 && (
                <Dropdown
                  label={t('SSH config aliases')}
                  value=""
                  placeholder={t('Choose from your SSH config')}
                  options={aliases.map((alias) => ({ value: alias, label: alias }))}
                  onChange={read}
                  disabled={busy}
                />
              )}
              <p className="m-0 text-caption text-muted-foreground">
                {ssh
                  ? t(
                      'Connects over SSH with your keys and ~/.ssh/config. Ramu must already be installed on that host. Ramu starts it there if needed, and no port is opened to the network.',
                    )
                  : t(
                      'On that host, open Devices & access and choose Connect a device. Paste its link, or type its address and code.',
                    )}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {!ssh && (
                  <Input
                    aria-label={t('Pairing code')}
                    placeholder={t('Pairing code')}
                    autoFocus={focusCode}
                    autoCapitalize="characters"
                    spellCheck={false}
                    value={code}
                    disabled={busy}
                    onChange={(event) => setCode(event.target.value)}
                  />
                )}
                <Input
                  aria-label={t('Name')}
                  placeholder={t('Name (optional)')}
                  maxLength={60}
                  value={name}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </form>
          )}
          {error && (
            <p className="m-0 text-caption text-bad" role="alert">
              {error}
            </p>
          )}
        </DialogScrollBody>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </Button>
          {mode === 'address' && !asking && (
            <Button
              type="submit"
              form="add-host"
              variant="default"
              disabled={busy || (ssh ? !text.trim() : !address || !code.trim())}
            >
              {busy ? (ssh ? t('Connecting…') : t('Pairing…')) : ssh ? t('Connect') : t('Pair')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
