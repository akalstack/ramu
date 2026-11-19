import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Rule } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../i18n'
import { invokeOn } from '../ipc'
import { errorText } from '../lib/errors'
import { useComputers } from '../workspace/computers'

type There = { state: 'same' | 'different' | 'missing'; rule?: Rule } | { state: 'unknown' }

/** The same rule on another host: its name, for every project there, with the same text and activation. */
function compare(rule: Rule, rules: Rule[]): There {
  const there = rules.find((entry) => entry.projectId === null && entry.name === rule.name)
  if (!there) return { state: 'missing' }
  const same =
    there.body.trim() === rule.body.trim() &&
    there.activation === rule.activation &&
    there.paths.join('\n') === rule.paths.join('\n')
  return { state: same ? 'same' : 'different', rule: there }
}

const stateText = (there: There) =>
  there.state === 'same'
    ? t('Same text there')
    : there.state === 'different'
      ? t('Different text there')
      : there.state === 'missing'
        ? t('Not there')
        : t('Could not check')

/**
 * Which of your other connected hosts have a rule for every project, and copying it to one that lacks it or has other
 * text. The copy is saved there as a rule of that host, like one written there.
 */
export function RuleOnHosts({ rule, hostId, readOnly }: { rule: Rule; hostId: string; readOnly: boolean }) {
  useLanguage()
  const computers = useComputers()
  const others = (computers?.computers ?? []).filter(
    (computer) => computer.id !== hostId && computer.status === 'connected',
  )
  const othersKey = others.map((computer) => computer.id).join(',')
  const [states, setStates] = useState<Record<string, There>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void Promise.all(
      others.map(async (computer) => {
        try {
          return [computer.id, compare(rule, await invokeOn(computer.id, 'rules.list'))] as const
        } catch {
          return [computer.id, { state: 'unknown' }] as const
        }
      }),
    ).then((found) => live && setStates(Object.fromEntries(found)))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- checked again when the rule or the connected hosts change
  }, [othersKey, rule.id, rule.revision])
  if (!others.length) return null
  const copy = async (id: string) => {
    const there = states[id]
    setBusy(id)
    setError(null)
    try {
      const saved = await invokeOn(id, 'rules.save', {
        ...(there && 'rule' in there && there.rule ? { id: there.rule.id, baseRevision: there.rule.revision } : {}),
        name: rule.name,
        body: rule.body,
        projectId: null,
        providers: rule.providers,
        activation: rule.activation,
        paths: rule.paths,
        enabled: rule.enabled,
      })
      setStates((current) => ({ ...current, [id]: { state: 'same', rule: saved } }))
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section
      className="flex flex-col gap-1.5 rounded-(--radius-s) bg-fill px-3 py-2"
      aria-label={t('On your other hosts')}
    >
      <span className="text-control text-foreground">{t('On your other hosts')}</span>
      {others.map((computer) => {
        const there = states[computer.id]
        return (
          <div key={computer.id} className="flex items-center gap-2 text-control">
            <span className="min-w-0 truncate">{computer.name}</span>
            <span className="flex-1 text-caption text-muted-foreground">
              {there ? stateText(there) : t('Checking…')}
            </span>
            {(there?.state === 'missing' || there?.state === 'different') && (
              <Button
                size="xs"
                variant="secondary"
                disabled={readOnly || busy !== null}
                onClick={() => void copy(computer.id)}
              >
                {busy === computer.id ? <RefreshCw size={12} className="animate-spin" /> : null}
                {there.state === 'missing' ? t('Copy there') : t('Replace there')}
              </Button>
            )}
          </div>
        )
      })}
      {error && (
        <span role="alert" className="text-caption text-bad">
          {error}
        </span>
      )}
    </section>
  )
}
