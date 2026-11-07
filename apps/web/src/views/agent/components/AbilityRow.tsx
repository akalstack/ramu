import { useState } from 'react'
import { BookOpen, ImageIcon, Search, Sparkles } from 'lucide-react'
import { ABILITY_DONE, ABILITY_LABELS, type AbilityCall } from '@ramu/shared/providers/abilities'
import { providerName } from '@ramu/shared/providers/providers'
import { Button } from '@/components/desktop-button'
import { formatLocale, t, useLanguage } from '../../../i18n'
import { Attachments } from '../../../composer/Attachments'
import { useHost } from '../../../workspace/HostProvider'
import { notifyError } from '../../../chat/Notifications'
import { errorText } from '../../../lib/errors'
import { GHOST_TEXT_BUTTON_CLASS } from '../styles'

const ICONS = { image_generation: ImageIcon, image_edit: ImageIcon, web_search: Search, long_context: BookOpen }

/** Who ran the call, as the row's headline says it. */
const abilityRunner = (call: AbilityCall) =>
  call.mcp
    ? call.mcp.server
    : call.provider === 'ramu'
      ? t("Ramu's search")
      : call.provider
        ? providerName(call.provider)
        : ''

/** One ability call in the thread: what ran where, what was sent, the result, and how to run it again. */
export function AbilityRow({ call, sessionId, live }: { call: AbilityCall; sessionId: string; live: boolean }) {
  useLanguage()
  const { invoke } = useHost()
  const [running, setRunning] = useState<'same' | 'other' | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const Icon = ICONS[call.ability as keyof typeof ICONS] ?? Sparkles
  const done = call.status === 'done'
  const image = call.ability === 'image_generation' || call.ability === 'image_edit'
  const headline = done
    ? t(ABILITY_DONE[call.ability], { '0': abilityRunner(call) })
    : call.status === 'refused'
      ? t('{0} not used', { '0': t(ABILITY_LABELS[call.ability]) })
      : t('{0} failed', { '0': t(ABILITY_LABELS[call.ability]) })
  const facts = [
    call.model,
    call.cheapest ? t('chosen as the cheapest good enough') : '',
    call.costUsd
      ? new Intl.NumberFormat(formatLocale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 3 }).format(
          call.costUsd,
        )
      : '',
    call.durationMs ? t('{0}s', { '0': String(Math.max(1, Math.round(call.durationMs / 1000))) }) : '',
    call.tokens ? t('{0} tokens', { '0': (call.tokens.input + call.tokens.output).toLocaleString() }) : '',
  ].filter(Boolean)
  const again = (other: boolean) => {
    setRunning(other ? 'other' : 'same')
    void invoke('abilities.again', sessionId, call.id, other)
      .catch((error) => notifyError(errorText(error), t(ABILITY_LABELS[call.ability])))
      .finally(() => setRunning(null))
  }
  return (
    <section
      className="ability-row my-1 grid gap-2 rounded-(--radius-m) border border-(--line) bg-fill p-[10px_12px] text-control"
      aria-label={headline}
    >
      <header className="flex min-w-0 items-center gap-2">
        <Icon size={14} className={`flex-none ${done ? 'text-muted-foreground' : 'text-bad'}`} aria-hidden />
        <span className="min-w-0 truncate font-medium text-soft">{headline}</span>
        {facts.length > 0 && (
          <span className="min-w-0 truncate text-caption text-muted-foreground">{facts.join(' · ')}</span>
        )}
      </header>
      {call.sent.prompt && (
        <p className="m-0 text-caption text-muted-foreground break-words">
          <span className="text-soft">{t('Sent')}:</span> “{call.sent.prompt}”
          {call.sent.inputs.length ? ` · ${call.sent.inputs.join(', ')}` : ''}
        </p>
      )}
      {call.attachments?.length ? <Attachments files={call.attachments} names /> : null}
      {done && !image && call.summary && (
        <p className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words text-caption text-soft">
          {call.summary}
        </p>
      )}
      {!done && <p className="m-0 text-caption text-soft break-words">{call.summary}</p>}
      {call.sources?.length ? (
        <ul className="m-0 grid list-none gap-0.5 p-0 text-caption">
          {call.sources.map((source) => (
            <li key={source.url} className="min-w-0 truncate">
              <a href={source.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-soft">
                {source.title}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {live && !dismissed && (
        <div className="flex flex-wrap gap-1">
          {done && image && (
            <Button
              variant="ghost"
              size="sm"
              className={GHOST_TEXT_BUTTON_CLASS}
              disabled={running !== null}
              onClick={() => again(false)}
            >
              {running === 'same' ? t('Making another…') : t('Make another')}
            </Button>
          )}
          {done && call.provider !== 'ramu' && !call.mcp && (
            <Button
              variant="ghost"
              size="sm"
              className={GHOST_TEXT_BUTTON_CLASS}
              disabled={running !== null}
              onClick={() => again(true)}
            >
              {running === 'other' ? t('Running…') : t('Use another provider')}
            </Button>
          )}
          {call.refusal === 'unavailable' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className={GHOST_TEXT_BUTTON_CLASS}
                onClick={() =>
                  window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'providers' } }))
                }
              >
                {t('Set up a provider')}
              </Button>
              <Button variant="ghost" size="sm" className={GHOST_TEXT_BUTTON_CLASS} onClick={() => setDismissed(true)}>
                {t('Not now')}
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
