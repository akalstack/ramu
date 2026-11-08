import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/site-button'

/* Hero demo: one sentence becomes a live app on the person's own hosting account. */

type Step =
  | { kind: 'user'; text: string }
  | { kind: 'ask'; question: string; answer: string }
  | { kind: 'tool'; label: string; detail: string }
  | { kind: 'agent'; text: string }
  | { kind: 'live' }

const TARGETS = [
  { id: 'vercel', name: 'Vercel', host: 'barbershop.vercel.app' },
  { id: 'netlify', name: 'Netlify', host: 'barbershop.netlify.app' },
] as const

const steps = (target: (typeof TARGETS)[number]): Step[] => [
  { kind: 'user', text: 'A booking page for my barbershop where customers pick a time and I get an email.' },
  { kind: 'ask', question: 'Web or phone app?', answer: 'Web' },
  { kind: 'ask', question: 'Store bookings?', answer: 'Yes, in a database' },
  { kind: 'agent', text: `Next.js with a Postgres database, deployed on ${target.name}. Starting the project.` },
  { kind: 'tool', label: 'Run', detail: 'npx create-next-app barbershop' },
  { kind: 'tool', label: 'Run', detail: 'pnpm build  ·  pnpm test  12 passed' },
  { kind: 'agent', text: 'The booking page works in the preview. Ready to put it online?' },
  { kind: 'tool', label: 'Deploy', detail: `${target.name} · your account · database provisioned` },
  { kind: 'live' },
]

/** The path's stages, and the step at which each is reached. */
const STAGES = [
  { label: 'Asked', at: 2 },
  { label: 'Project made', at: 4 },
  { label: 'Built and tested', at: 5 },
  { label: 'Preview running', at: 6 },
  { label: 'Live', at: 8 },
]

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

export function Demo() {
  const reduced = useReducedMotion()
  const [targetId, setTargetId] = useState<(typeof TARGETS)[number]['id']>('vercel')
  const [run, setRun] = useState(0)
  const [played, setPlayed] = useState(0)
  const target = TARGETS.find((entry) => entry.id === targetId)!
  const all = steps(target)
  const last = all.length - 1
  const step = reduced ? last : played

  useEffect(() => {
    if (reduced) return
    setPlayed(0)
    const timers = all
      .slice(1)
      .map((_, i) => window.setTimeout(() => setPlayed(i + 1), 900 * (i + 1) + (i >= 6 ? 600 : 0)))
    return () => timers.forEach(window.clearTimeout)
    // The steps change only with the target, which the effect already follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, run, reduced])

  const finished = step >= last

  return (
    <div className="demo" aria-label="Demo: one sentence becoming a live app on your own account">
      <div className="demo-thread">
        <header className="thread-head">
          <span className="thread-title">Barbershop booking</span>
          <span className="thread-branch">main</span>
          <span className="thread-model">{step >= 6 ? 'Preview running' : 'Building'}</span>
        </header>
        <ol className="thread-body" aria-live="polite">
          {all.slice(0, step + 1).map((s, i) => {
            if (s.kind === 'user')
              return (
                <li key={i} className="msg msg-user">
                  {s.text}
                </li>
              )
            if (s.kind === 'ask')
              return (
                <li key={i} className="tool">
                  <span className="tool-label">Asks</span>
                  <span className="tool-detail">{s.question}</span>
                  <span className="tool-who">{s.answer}</span>
                </li>
              )
            if (s.kind === 'tool')
              return (
                <li key={i} className="tool">
                  <span className="tool-label">{s.label}</span>
                  <span className="tool-detail">{s.detail}</span>
                </li>
              )
            if (s.kind === 'live')
              return (
                <li key={i} className="seam">
                  <span className="seam-dot" aria-hidden="true" />
                  <span>
                    Your app is live at https://{target.host}. Every change from here arrives as a pull request with a
                    preview.
                  </span>
                </li>
              )
            return (
              <li key={i} className="msg msg-agent">
                <span>{s.text}</span>
              </li>
            )
          })}
        </ol>
      </div>

      <aside className="demo-side">
        <h2 className="side-title">The path</h2>
        <ul className="meters">
          {STAGES.map((stage) => {
            const done = step >= stage.at
            return (
              <li key={stage.label} className={`meter${done ? ' is-active' : ''}`}>
                <div className="meter-body">
                  <div className="meter-row">
                    <span>{stage.label}</span>
                    <span className="meter-state">{done ? 'Done' : 'Next'}</span>
                  </div>
                  <div className="meter-track" role="img" aria-label={`${stage.label} ${done ? 'done' : 'not yet'}`}>
                    <div className="meter-fill" style={{ width: done ? '100%' : '0%' }} />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
        <div className="side-controls">
          <label className="side-label" htmlFor="deploy-to">
            Deploy to
          </label>
          <div className="seg" role="radiogroup" id="deploy-to">
            {TARGETS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={targetId === entry.id}
                className={targetId === entry.id ? 'is-on' : ''}
                onClick={() => setTargetId(entry.id)}
              >
                {entry.name}
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
