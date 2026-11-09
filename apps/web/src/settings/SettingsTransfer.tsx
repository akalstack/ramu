import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import {
  TRANSFER_GROUPS,
  defaultGroups,
  settingsExportSchema,
  type SettingsExport,
  type TransferChange,
  type TransferGroup,
} from '@ramu/shared/settingsTransfer'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/desktop-checkbox'
import { Dialog, Dropdown } from '../Menu'
import { useViewOnly } from '../composer/useViewOnly'
import { t, useLanguage } from '../i18n'
import { invokeOn } from '../ipc'
import { errorText } from '../lib/errors'
import { useComputers } from '../workspace/computers'
import { useHost } from '../workspace/HostProvider'
import { SettingsSectionHead } from './cards'

interface Review {
  file: SettingsExport
  groups: TransferGroup[]
  changes: TransferChange[]
  connectHere: string[]
  from: string
}

/**
 * Copy settings from a paired host, or export and import them as a file: appearance, models and abilities, agent
 * defaults, Git and commit style, notifications, rules, identities and everywhere notes. Paths, credentials, account
 * tokens and workspace state never move. Every value that would change is listed before **Copy**.
 */
export function SettingsTransfer() {
  useLanguage()
  const host = useHost()
  const viewOnly = useViewOnly()
  const computers = useComputers()
  const others = (computers?.computers ?? []).filter(
    (computer) => computer.id !== host.id && computer.status === 'connected',
  )
  const [source, setSource] = useState('')
  const [review, setReview] = useState<Review | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const act = async (run: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await run()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }
  const open = async (
    exported: SettingsExport,
    from: string,
    groups = defaultGroups(exported).filter((group) => exported.groups.includes(group)),
  ) => {
    const preview = await host.invoke('settingsTransfer.preview', exported, groups)
    setReview({ file: exported, groups, from, ...preview })
  }
  const toggle = (group: TransferGroup, on: boolean) =>
    review &&
    void act(() =>
      open(review.file, review.from, on ? [...review.groups, group] : review.groups.filter((entry) => entry !== group)),
    )
  return (
    <section className="flex flex-col gap-2" aria-label={t('Copy settings')}>
      <SettingsSectionHead
        title={t('Copy settings')}
        help={t(
          'Bring theme, models, rules, commit style and identities to this host from another, or move them with a file. Credentials and paths never move.',
        )}
      />
      <div className="flex flex-wrap items-center gap-2">
        {others.length > 0 && (
          <>
            <Dropdown
              label={t('Copy settings from…')}
              value={source}
              placeholder={t('Copy settings from…')}
              options={others.map((computer) => ({ value: computer.id, label: computer.name }))}
              onChange={(id) => {
                setSource(id)
                void act(async () => {
                  const exported = await invokeOn(id, 'settingsTransfer.export', [
                    ...TRANSFER_GROUPS.map((group) => group.id),
                  ])
                  await open(exported, others.find((computer) => computer.id === id)?.name ?? id)
                })
              }}
              disabled={viewOnly || busy}
            />
          </>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const exported = await host.invoke(
                'settingsTransfer.export',
                TRANSFER_GROUPS.map((group) => group.id).filter((group) => group !== 'memories'),
              )
              const link = document.createElement('a')
              link.href = URL.createObjectURL(
                new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }),
              )
              link.download = `ramu-settings-${exported.host}.json`
              link.click()
              URL.revokeObjectURL(link.href)
            })
          }
        >
          <Download size={13} />
          {t('Export settings')}
        </Button>
        <Button size="sm" variant="secondary" disabled={viewOnly || busy} onClick={() => file.current?.click()}>
          <Upload size={13} />
          {t('Import settings')}
        </Button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            event.target.value = ''
            if (chosen)
              void act(async () => {
                const parsed = settingsExportSchema.safeParse(JSON.parse(await chosen.text()))
                if (!parsed.success) throw new Error(t('That file is not a Ramu settings export.'))
                await open(parsed.data, chosen.name)
              })
          }}
        />
      </div>
      {error && !review && (
        <p role="alert" className="m-0 text-caption text-bad">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="m-0 text-caption text-muted-foreground">
          {done}
        </p>
      )}
      {review && (
        <Dialog
          title={t('Copy settings from {0}', { 0: review.from })}
          confirmLabel={t('Copy')}
          busy={busy}
          error={error}
          confirmDisabled={viewOnly || !review.changes.length}
          onCancel={() => {
            setReview(null)
            setSource('')
          }}
          onConfirm={() =>
            void act(async () => {
              const applied = await host.invoke(
                'settingsTransfer.apply',
                review.file,
                review.groups,
                review.changes.length,
              )
              setReview(null)
              setSource('')
              setDone(
                applied.connectHere.length
                  ? t('Copied {0} settings. Connect on this host: {1}', {
                      0: applied.changed,
                      1: applied.connectHere.join(', '),
                    })
                  : t('Copied {0} settings.', { 0: applied.changed }),
              )
            })
          }
        >
          <div className="flex flex-col gap-2 text-control">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {TRANSFER_GROUPS.filter((group) => review.file.groups.includes(group.id)).map((group) => (
                <label key={group.id} className="flex items-center gap-1.5">
                  <Checkbox
                    checked={review.groups.includes(group.id)}
                    disabled={busy}
                    onCheckedChange={(value) => toggle(group.id, value === true)}
                  />
                  {t(group.label)}
                </label>
              ))}
            </div>
            {review.changes.length ? (
              <ul className="m-0 max-h-72 overflow-auto pl-4">
                {review.changes.map((change) => (
                  <li key={`${change.group}:${change.label}`} className="break-all">
                    <strong>{change.label}</strong>: {change.before === null ? t('new') : change.before} →{' '}
                    {change.after}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-muted-foreground">{t('Nothing would change.')}</p>
            )}
            {review.connectHere.length > 0 && (
              <p className="m-0 text-caption text-muted-foreground">
                {t('Connect on this host: {0}', { 0: review.connectHere.join(', ') })}
              </p>
            )}
          </div>
        </Dialog>
      )}
    </section>
  )
}
