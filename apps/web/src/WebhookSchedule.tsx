// A schedule started by webhook requests: choosing what starts it in the editor, and on its card the address to give
// the sender, the secret, and every request that arrived with what came of it.
import { useCallback, useEffect, useState } from 'react'
import { Eye, EyeOff, FlaskConical, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import {
  SOURCE_DEFAULTS,
  WEBHOOK_PRESETS,
  type WebhookFilter,
  type WebhookFilterOp,
  type WebhookTrigger,
} from '@ramu/shared/webhooks'
import type { Schedule, ScheduleRun, WebhookDelivery } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { BrandIcon } from '@/components/brand-icon'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dropdown } from './Menu'
import { CopyButton } from './views/agent/components/CopyButton'
import { errorText } from './lib/errors'
import { notifyError } from './chat/Notifications'
import { t, useLanguage } from './i18n'
import { presetOf, splitList, webhookRule } from './scheduleForm'

const OPS: { value: WebhookFilterOp; label: string }[] = [
  { value: 'equals', label: 'is' },
  { value: 'notEquals', label: 'is not' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'in', label: 'is one of' },
  { value: 'exists', label: 'is present' },
]
const CUSTOM = 'custom'

/** The editor's fields for a webhook rule. Picking a trigger fills the name and prompt when they are still empty. */
export function WebhookFields({
  rule,
  onRule,
  onPreset,
}: {
  rule: WebhookTrigger
  onRule: (rule: WebhookTrigger) => void
  onPreset: (name: string, prompt: string) => void
}) {
  useLanguage()
  const preset = presetOf(rule)
  const setFilter = (index: number, filter: WebhookFilter) =>
    onRule({ ...rule, filters: rule.filters.map((entry, i) => (i === index ? filter : entry)) })
  return (
    <>
      <label className="schedule-wide col-span-full">
        {t('Starts when')}
        <Dropdown
          label={t('Starts when')}
          icon={preset && <BrandIcon brand={SOURCE_DEFAULTS[preset.source].brand} />}
          value={preset?.id ?? CUSTOM}
          onChange={(id) => {
            const next = WEBHOOK_PRESETS.find((entry) => entry.id === id)
            if (!next) return
            onRule(webhookRule(next))
            onPreset(t(next.label), next.prompt)
          }}
          options={[
            ...WEBHOOK_PRESETS.map((entry) => ({
              value: entry.id,
              label: `${t(SOURCE_DEFAULTS[entry.source].label)}: ${t(entry.label)}`,
            })),
            ...(preset ? [] : [{ value: CUSTOM, label: t('Your own filters') }]),
          ]}
        />
        <span className="muted text-muted-foreground small text-caption">
          {preset ? t(preset.description) : t('Filters you changed by hand.')}
        </span>
      </label>
      <div className="schedule-wide col-span-full flex flex-col gap-2">
        <span className="text-caption">{t('Only when')}</span>
        {rule.filters.length === 0 && (
          <span className="muted text-muted-foreground small text-caption">{t('Every request starts a run.')}</span>
        )}
        {rule.filters.map((filter, index) => (
          <div
            key={index}
            className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-2"
          >
            <Input
              aria-label={t('Field')}
              value={filter.path}
              placeholder="body.action"
              onChange={(event) => setFilter(index, { ...filter, path: event.target.value })}
            />
            <Dropdown
              label={t('Comparison')}
              value={filter.op}
              onChange={(op) => {
                const text =
                  'value' in filter ? (Array.isArray(filter.value) ? filter.value.join(', ') : filter.value) : ''
                setFilter(
                  index,
                  op === 'exists'
                    ? { path: filter.path, op }
                    : op === 'in'
                      ? { path: filter.path, op, value: splitList(text) }
                      : { path: filter.path, op: op as 'equals' | 'notEquals' | 'startsWith', value: text },
                )
              }}
              options={OPS.map((op) => ({ value: op.value, label: t(op.label) }))}
            />
            {filter.op === 'exists' ? (
              <span />
            ) : (
              <Input
                aria-label={t('Value')}
                value={Array.isArray(filter.value) ? filter.value.join(', ') : filter.value}
                placeholder={filter.op === 'in' ? 'opened, reopened' : 'completed'}
                onChange={(event) =>
                  setFilter(
                    index,
                    filter.op === 'in'
                      ? { ...filter, value: splitList(event.target.value) }
                      : { ...filter, value: event.target.value },
                  )
                }
              />
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              aria-label={t('Remove this filter')}
              title={t('Remove this filter')}
              onClick={() => onRule({ ...rule, filters: rule.filters.filter((_, i) => i !== index) })}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        ))}
        {rule.filters.length < 16 && (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="self-start"
            onClick={() =>
              onRule({ ...rule, filters: [...rule.filters, { path: 'body.action', op: 'equals', value: '' }] })
            }
          >
            <Plus size={13} />
            {t('Add a filter')}
          </Button>
        )}
      </div>
      <label className="schedule-wide col-span-full">
        {t('What the agent reads from the request')}
        <Textarea
          rows={3}
          value={rule.fields.join('\n')}
          placeholder={t('One field per line, such as body.pull_request.title. Empty sends the whole body.')}
          onChange={(event) =>
            onRule({
              ...rule,
              fields: event.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      {rule.source === 'generic' && (
        <label>
          {t('Signed by the sender')}
          <Dropdown
            label={t('Signed by the sender')}
            value={rule.signature ? 'hmac' : 'none'}
            onChange={(value) =>
              onRule({
                ...rule,
                signature:
                  value === 'hmac' ? { kind: 'hmac', header: 'x-signature', encoding: 'hex', prefix: 'sha256=' } : null,
              })
            }
            options={[
              { value: 'none', label: t('No, the address is enough') },
              { value: 'hmac', label: t('HMAC-SHA256 in a header') },
            ]}
          />
        </label>
      )}
      {rule.source === 'generic' && rule.signature?.kind === 'hmac' && (
        <label>
          {t('Signature header')}
          <Input
            value={rule.signature.header}
            onChange={(event) =>
              onRule({
                ...rule,
                signature: { ...rule.signature!, header: event.target.value } as WebhookTrigger['signature'],
              })
            }
          />
        </label>
      )}
      <p className="muted text-muted-foreground small text-caption">
        {t(
          'After saving, the schedule’s card shows the address and secret to give the sender. Requests for the same subject within two minutes join one run.',
        )}
      </p>
    </>
  )
}

type Invoke = ReturnType<typeof import('./ipc').invokerFor>

const OUTCOME_TONE: Record<WebhookDelivery['outcome'], string> = {
  started: 'text-soft',
  coalesced: 'text-soft',
  test: 'text-soft',
  replayed: 'text-soft',
  filtered: 'text-muted-foreground',
  duplicate: 'text-muted-foreground',
  paused: 'text-muted-foreground',
  'bad-signature': 'text-bad',
  invalid: 'text-bad',
}
const OUTCOME_LABEL: Record<WebhookDelivery['outcome'], string> = {
  started: 'Started',
  coalesced: 'Joined a run',
  test: 'Test',
  replayed: 'Replayed',
  filtered: 'Filtered out',
  duplicate: 'Repeat',
  paused: 'Not run',
  'bad-signature': 'Bad signature',
  invalid: 'Invalid',
}

/** On the card: where to send requests, the secret, and what arrived. */
export function WebhookPanel({
  schedule,
  runs,
  invoke,
  readOnly,
  onOpenRun,
}: {
  schedule: Schedule
  runs: ScheduleRun[]
  invoke: Invoke
  readOnly: boolean
  onOpenRun: (run: ScheduleRun) => void
}) {
  useLanguage()
  const [address, setAddress] = useState<{
    urls: { url: string; via: string }[]
    path: string
    secret: string | null
  } | null>(null)
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [showSecret, setShowSecret] = useState(false)
  const [secretDraft, setSecretDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const rule = schedule.rule as WebhookTrigger
  const [repos, setRepos] = useState<{ repoId: string; name: string; slug: string }[]>([])
  const [repoId, setRepoId] = useState('')
  useEffect(() => {
    if (readOnly || rule.source !== 'github') return
    void invoke('schedules.githubRepos', schedule.id).then(
      (found) => {
        setRepos(found)
        setRepoId((current) => current || found[0]?.repoId || '')
      },
      () => {},
    )
  }, [invoke, schedule.id, readOnly, rule.source])
  const load = useCallback(() => {
    if (readOnly) return
    void invoke('schedules.webhook', schedule.id).then(setAddress, () => {})
    void invoke('schedules.deliveries', schedule.id).then(setDeliveries, () => {})
  }, [invoke, schedule.id, readOnly])
  // Requests arrive on their own; while the panel is open, keep the log current.
  useEffect(() => {
    load()
    const timer = window.setInterval(load, 5000)
    return () => window.clearInterval(timer)
  }, [load])
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await work()
      load()
    } catch (error) {
      notifyError(errorText(error), t('Webhook'))
    } finally {
      setBusy(false)
    }
  }
  if (readOnly)
    return (
      <p className="m-0 mt-1 text-caption text-muted-foreground">
        {t('Its address is shown only on devices with full access.')}
      </p>
    )
  return (
    <div className="mt-1 flex flex-col gap-2 border-t border-(--line) pt-2 text-caption">
      {address && address.urls.length > 0 ? (
        address.urls.map((entry) => (
          <div key={entry.url} className="flex min-h-7 items-center gap-2">
            <span className="flex-none text-muted-foreground">{entry.via}</span>
            <code className="min-w-0 flex-1 truncate font-mono" title={entry.url}>
              {entry.url}
            </code>
            <CopyButton text={entry.url} />
          </div>
        ))
      ) : (
        <p className="m-0 text-muted-foreground">
          {t(
            'Nothing outside this computer can reach it yet. Turn on Allow other devices in Settings → Remote access; the address then appears here.',
          )}
          {address && (
            <>
              {' '}
              <code className="font-mono">{address.path}</code>
            </>
          )}
        </p>
      )}
      {rule.signature && (
        <div className="flex min-h-7 items-center gap-2">
          <span className="flex-none text-muted-foreground">{t('Secret')}</span>
          <code className="min-w-0 flex-1 truncate font-mono">
            {address?.secret ? (showSecret ? address.secret : '•'.repeat(24)) : t('Not set')}
          </code>
          {address?.secret && (
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={showSecret ? t('Hide secret') : t('Show secret')}
                title={showSecret ? t('Hide secret') : t('Show secret')}
                onClick={() => setShowSecret(!showSecret)}
              >
                {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
              </Button>
              <CopyButton text={address.secret} />
            </>
          )}
        </div>
      )}
      {(rule.source === 'sentry' || rule.source === 'vercel') && (
        <div className="flex items-center gap-2">
          <Input
            aria-label={rule.source === 'sentry' ? t('Client secret from Sentry') : t('Webhook secret from Vercel')}
            placeholder={rule.source === 'sentry' ? t('Client secret from Sentry') : t('Webhook secret from Vercel')}
            type="password"
            value={secretDraft}
            onChange={(event) => setSecretDraft(event.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || secretDraft.trim().length < 8}
            onClick={() =>
              void act(async () => {
                await invoke('schedules.setWebhookSecret', schedule.id, secretDraft.trim())
                setSecretDraft('')
              })
            }
          >
            {t('Save')}
          </Button>
        </div>
      )}
      {rule.source === 'github' && (
        <div className="flex min-h-7 flex-wrap items-center gap-2">
          {schedule.webhook?.github ? (
            <span className="text-soft">{t('Set up on GitHub for {0}', { 0: schedule.webhook.github })}</span>
          ) : repos.length === 0 ? (
            <span className="text-muted-foreground">
              {t(
                'Add the address and secret to the repository’s webhooks on GitHub, or add a GitHub repository to this project.',
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">{t('Ramu can create the webhook on GitHub for you.')}</span>
          )}
          {repos.length > 1 && (
            <Dropdown
              label={t('Repository')}
              value={repoId}
              onChange={setRepoId}
              options={repos.map((repo) => ({ value: repo.repoId, label: repo.slug }))}
            />
          )}
          {repos.length > 0 && (
            <Button
              size="sm"
              variant={schedule.webhook?.github ? 'ghost' : 'secondary'}
              disabled={busy || !repoId}
              onClick={() => void act(() => invoke('schedules.connectGithub', schedule.id, repoId))}
            >
              {schedule.webhook?.github
                ? t('Create again')
                : t('Create on {0}', { 0: repos.find((repo) => repo.repoId === repoId)?.slug ?? 'GitHub' })}
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void act(() => invoke('schedules.sendTest', schedule.id))}
        >
          <FlaskConical size={13} />
          {t('Send test')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            if (
              confirm(t('Make a new address and secret? The sender stops reaching this schedule until you update it.'))
            )
              void act(() => invoke('schedules.rotateWebhook', schedule.id))
          }}
        >
          <RefreshCw size={13} />
          {t('New address')}
        </Button>
      </div>
      <strong className="font-medium">{t('Requests')}</strong>
      {deliveries.length === 0 && (
        <p className="m-0 text-muted-foreground">
          {t('Nothing has arrived yet. Send test shows what a run looks like.')}
        </p>
      )}
      {deliveries.map((delivery) => {
        const run = delivery.runId ? runs.find((entry) => entry.id === delivery.runId) : undefined
        return (
          <div key={delivery.id} className="flex min-h-8 items-center gap-2">
            <span
              className={`flex-none rounded-full bg-hover px-2 whitespace-nowrap ${OUTCOME_TONE[delivery.outcome]}`}
            >
              {t(OUTCOME_LABEL[delivery.outcome])}
            </span>
            <span className="min-w-0 flex-1 truncate text-soft" title={delivery.detail ?? delivery.summary}>
              {new Date(delivery.receivedAt).toLocaleString()} · {delivery.summary}
              {delivery.detail && <span className="text-muted-foreground"> · {delivery.detail}</span>}
            </span>
            {run?.taskId ? (
              <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => onOpenRun(run)}>
                {t('Open thread')}
              </Button>
            ) : (
              !delivery.runId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5"
                  disabled={busy}
                  title={t('Start a run from this request anyway')}
                  onClick={() => void act(() => invoke('schedules.replay', schedule.id, delivery.id))}
                >
                  <RotateCcw size={12} />
                  {t('Replay')}
                </Button>
              )
            )}
          </div>
        )
      })}
    </div>
  )
}
