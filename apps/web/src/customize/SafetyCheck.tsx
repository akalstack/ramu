import { useState } from 'react'
import { RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import type { RamuMethods } from '@ramu/shared/api'
import type { ToolAudit } from '@ramu/shared/toolAudit'
import { Button } from '@/components/desktop-button'
import { cn } from 'cn'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { useHost } from '../workspace/HostProvider'

export type AuditTarget = Parameters<RamuMethods['tools.audit']>[0]

/** Checks kept for this session, so reopening a skill or plugin shows what was found without asking the model again. */
const kept = new Map<string, ToolAudit>()
const keyOf = (hostId: string, target: AuditTarget) =>
  `${hostId}:${JSON.stringify({ ...target, ...('tools' in target ? { tools: target.tools?.length ?? 0 } : {}) })}`

const VERDICT = {
  safe: { Icon: ShieldCheck, tone: 'text-ok', label: 'Looks safe' },
  caution: { Icon: ShieldQuestion, tone: 'text-warn', label: 'Look before you use it' },
  unsafe: { Icon: ShieldAlert, tone: 'text-bad', label: 'Not safe as it is' },
} as const

const SEVERITY = { high: 'text-bad', medium: 'text-warn', low: 'text-muted-foreground' } as const

/**
 * A safety read by the host's model of what a skill, plugin or server tells agents and runs: scripts, commands, tool
 * descriptions. It costs a model call, so it runs when asked; the result stays for the session.
 */
export function SafetyCheck({ target, disabled }: { target: AuditTarget; disabled?: boolean }) {
  useLanguage()
  const host = useHost()
  const key = keyOf(host.id, target)
  // Bumped when a check finishes, so the kept result shows.
  const [, setChecked] = useState(0)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      const found = await host.invoke('tools.audit', target)
      kept.set(key, found)
      setChecked((value) => value + 1)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setRunning(false)
    }
  }
  const shown = kept.get(key) ?? null
  const verdict = shown ? VERDICT[shown.verdict] : null
  return (
    <section
      aria-label={t('Safety check')}
      aria-busy={running}
      className="flex min-w-0 flex-col gap-2 rounded-(--radius-s) bg-fill px-3 py-2.5"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {verdict ? (
            <verdict.Icon size={16} className={cn('flex-none', verdict.tone)} aria-hidden />
          ) : (
            <ShieldCheck size={16} className="flex-none text-muted-foreground" aria-hidden />
          )}
          <span className="flex min-w-0 flex-col">
            <span className={cn('text-control', verdict ? verdict.tone : 'text-foreground')}>
              {verdict ? t(verdict.label) : t('Safety check')}
            </span>
            <span className="text-caption text-muted-foreground">
              {running
                ? t('Reading its instructions, scripts and commands…')
                : shown
                  ? t('Checked by {0}. It can miss things.', { 0: shown.model })
                  : t('Have AI read its instructions, scripts and commands for anything risky.')}
            </span>
          </span>
        </span>
        <Button
          size="sm"
          variant="secondary"
          className="flex-none"
          disabled={disabled || running}
          onClick={() => void run()}
        >
          {running && <RefreshCw size={13} className="animate-spin" aria-hidden />}
          {shown ? t('Check again') : t('Check with AI')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="m-0 text-caption text-bad">
          {error}
        </p>
      )}
      {shown && (
        <div role="status" className="flex min-w-0 flex-col gap-1.5">
          {shown.summary && <p className="m-0 text-caption text-soft">{shown.summary}</p>}
          {shown.findings.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={t('What it found')}>
              {shown.findings.map((finding, index) => (
                <li key={index} className="flex min-w-0 gap-2 text-caption">
                  <span className={cn('flex-none font-medium', SEVERITY[finding.severity])}>
                    {finding.severity === 'high' ? t('High') : finding.severity === 'medium' ? t('Medium') : t('Low')}
                  </span>
                  <span className="min-w-0 text-muted-foreground">
                    {finding.where && <code className="mr-1 font-mono text-[11px] text-soft">{finding.where}</code>}
                    {finding.issue}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {shown.skipped.length > 0 && (
            <p className="m-0 text-caption text-muted-foreground">
              {t('Too long to read in full; not checked: {0}', { 0: shown.skipped.join(', ') })}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
