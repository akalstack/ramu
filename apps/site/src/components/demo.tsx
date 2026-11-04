import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ProviderLogo } from '@/components/provider-logo'
import { Button } from '@/components/site-button'
import { PROVIDERS, providerById, type Provider } from '@/lib/site'

/* Hero demo: a thread that moves to the next provider at a limit. */

type Step =
  | { kind: 'user'; text: string }
  | { kind: 'tool'; who: 0 | 1; label: string; detail: string }
  | { kind: 'agent'; who: 0 | 1; text: string }
  | { kind: 'seam' }

const STEPS: Step[] = [
  { kind: 'user', text: 'Add rate limiting to the /v1/quote route.' },
  { kind: 'tool', who: 0, label: 'Read', detail: 'src/routes/quote.ts' },
  { kind: 'tool', who: 0, label: 'Edit', detail: 'src/middleware/limit.ts  +42 −3' },
  { kind: 'agent', who: 0, text: 'Sliding-window limiter is in. Wiring it into the route next, then tests.' },
  { kind: 'seam' },
  { kind: 'tool', who: 1, label: 'Edit', detail: 'src/routes/quote.ts  +6 −1' },
  { kind: 'tool', who: 1, label: 'Run', detail: 'pnpm test  24 passed' },
  { kind: 'agent', who: 1, text: '/v1/quote now allows 60 requests a minute per key. Tests pass.' },
]

const FIRST_METER = [0, 14, 41, 78, 100, 100, 100, 100]
const SECOND_METER = [0, 0, 0, 0, 6, 19, 33, 38]
const STARTERS = ['claude', 'codex', 'cursor']
const LAST = STEPS.length - 1

const REDUCED = '(prefers-reduced-motion: reduce)'
const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** False while rendering the static HTML, so hydration matches it; the real preference applies right after. */
function useReducedMotion() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  )
}

function Meter({
  provider,
  value,
  active,
  limited,
}: {
  provider: Provider
  value: number
  active: boolean
  limited: boolean
}) {
  return (
    <li className={`meter${active ? ' is-active' : ''}${limited ? ' is-limited' : ''}`}>
      <ProviderLogo provider={provider} size={26} />
      <div className="meter-body">
        <div className="meter-row">
          <span>{provider.name}</span>
          <span className="meter-state">{limited ? 'Limit reached' : active ? 'Working' : 'Standing by'}</span>
        </div>
        <div className="meter-track" role="img" aria-label={`${provider.name} usage ${value} percent`}>
          <div className="meter-fill" style={{ width: `${value}%` }} />
        </div>
      </div>
    </li>
  )
}

export function Demo() {
  const reduced = useReducedMotion()
  const [startId, setStartId] = useState('claude')
  const [run, setRun] = useState(0)
  const [played, setPlayed] = useState(0)
  const step = reduced ? LAST : played

  const order = useMemo(() => {
    const rest = PROVIDERS.filter((p) => p.id !== startId && STARTERS.includes(p.id))
    return [providerById(startId), rest[0]!, rest[1]!] as const
  }, [startId])

  useEffect(() => {
    if (reduced) return
    setPlayed(0)
    const timers = STEPS.slice(1).map((_, i) =>
      window.setTimeout(() => setPlayed(i + 1), 900 * (i + 1) + (i >= 3 ? 700 : 0)),
    )
    return () => timers.forEach(window.clearTimeout)
  }, [startId, run, reduced])

  const [first, second] = order
  const switched = step >= 4
  const finished = step >= LAST
  const current = switched ? second : first

  return (
    <div className="demo" aria-label="Demo: an agent thread continuing on a second provider">
      <div className="demo-thread">
        <header className="thread-head">
          <span className="thread-title">Rate limit /v1/quote</span>
          <span className="thread-branch">feat/rate-limit</span>
          <span className="thread-model" key={current.id}>
            <ProviderLogo provider={current} size={20} />
            {current.name}
          </span>
        </header>
        <ol className="thread-body" aria-live="polite">
          {STEPS.slice(0, step + 1).map((s, i) => {
            if (s.kind === 'user')
              return (
                <li key={i} className="msg msg-user">
                  {s.text}
                </li>
              )
            if (s.kind === 'seam')
              return (
                <li key={i} className="seam">
                  <span className="seam-dot" aria-hidden="true" />
                  <span>
                    {first.name} reached its usage limit. Continuing on {second.name} with the same thread.
                  </span>
                </li>
              )
            const who = order[s.who]
            if (s.kind === 'tool')
              return (
                <li key={i} className="tool">
                  <span className="tool-label">{s.label}</span>
                  <span className="tool-detail">{s.detail}</span>
                  <span className="tool-who">{who.name}</span>
                </li>
              )
            return (
              <li key={i} className="msg msg-agent">
                <ProviderLogo provider={who} size={20} />
                <span>{s.text}</span>
              </li>
            )
          })}
        </ol>
      </div>

      <aside className="demo-side">
        <h2 className="side-title">Fallback order</h2>
        <ul className="meters">
          {order.map((p, i) => (
            <Meter
              key={p.id}
              provider={p}
              value={i === 0 ? FIRST_METER[step]! : i === 1 ? SECOND_METER[step]! : 0}
              active={p.id === current.id}
              limited={i === 0 && switched}
            />
          ))}
        </ul>
        <div className="side-controls">
          <label className="side-label" htmlFor="start-with">
            Start with
          </label>
          <div className="seg" role="radiogroup" id="start-with">
            {STARTERS.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={startId === id}
                className={startId === id ? 'is-on' : ''}
                onClick={() => setStartId(id)}
              >
                {providerById(id).name}
              </button>
            ))}
          </div>
          <Button className="self-start" onClick={() => setRun((n) => n + 1)} disabled={!finished && !reduced}>
            Replay
          </Button>
        </div>
      </aside>
    </div>
  )
}
