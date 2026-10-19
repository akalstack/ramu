import { handoffSummary } from '@ramu/shared/chat/providerWait'
import { providerName } from '@ramu/shared/providers/providers'
import type { HandoffInfo } from '@ramu/shared/types'

type Translate = (text: string, values?: Record<string, string | number>) => string

/**
 * The second line of a "Context handoff" separator: what was carried to the new provider, such as "Carried events 1–412
 * from Claude Code (full handoff, 3 old results shortened)". Null until the next launch has built the handoff, since the
 * range is only known then.
 */
export function handoffLine(info: HandoffInfo | undefined, translate: Translate): string | null {
  const summary = handoffSummary(info)
  if (!summary?.range) return null
  const [from, to] = summary.range
  const values = { 0: from, 1: to, 2: summary.from ? providerName(summary.from) : '' }
  const base = summary.from
    ? translate('Carried events {0}–{1} from {2}', values)
    : translate('Carried events {0}–{1}', values)
  const details = [
    summary.mode === 'delta' ? translate('new events only') : translate('full handoff'),
    ...(summary.shortened ? [translate('{0} old results shortened', { 0: summary.shortened })] : []),
    ...(summary.omitted ? [translate('{0} events left out', { 0: summary.omitted })] : []),
  ]
  return `${base} (${details.join(', ')})`
}
