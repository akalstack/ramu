import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/site-button'

/* Hero demo: one sentence becomes a live app on the person's own hosting account. The preview card and the phone
   beside the window show where that result lands: a running site and a notification on the person's phone. */

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

const PROMPT = 'A booking page for my barbershop. Customers pick a time, I get an email.'

const steps = (target: (typeof TARGETS)[number]): Step[] => [
  { kind: 'user', text: PROMPT },
  { kind: 'ask', question: 'Web or phone app?', answer: 'Web' },
  { kind: 'ask', question: 'Store bookings?', answer: 'Yes, in a database' },
  { kind: 'agent', text: `Next.js with Postgres, deployed on ${target.name}. Starting the project.` },
  { kind: 'tool', label: 'Run', detail: 'npx create-next-app barbershop' },
  { kind: 'tool', label: 'Run', detail: 'pnpm build  ·  pnpm test  12 passed' },
  { kind: 'agent', text: 'The booking page works in the preview. Ready to put it online?' },
  { kind: 'tool', label: 'Deploy', detail: `${target.name} · your account · migrations ran first` },
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

const PREVIEW_AT = 6
const LIVE_AT = 8
const TYPE_MS = 28
const SLOTS = ['10:00', '11:30', '13:00', '15:30', '17:00']

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
  const [typed, setTyped] = useState(0)
  const [sent, setSent] = useState(false)
  const target = TARGETS.find((entry) => entry.id === targetId)!
  const all = steps(target)
  const last = all.length - 1
  const step = reduced ? last : played
  const chars = reduced ? PROMPT.length : typed
  const isSent = reduced || sent

  useEffect(() => {
    if (reduced) return
    setPlayed(0)
    setTyped(0)
    setSent(false)
    const typing = PROMPT.length * TYPE_MS
    const timers = Array.from({ length: PROMPT.length }, (_, i) =>
      window.setTimeout(() => setTyped(i + 1), TYPE_MS * (i + 1)),
    )
    timers.push(window.setTimeout(() => setSent(true), typing + 350))
    for (let i = 1; i <= last; i++) {
      timers.push(window.setTimeout(() => setPlayed(i), typing + 500 + 900 * i + (i >= 7 ? 600 : 0)))
    }
    return () => timers.forEach(window.clearTimeout)
  }, [targetId, run, reduced, last])

  const finished = step >= last
  const live = step >= LIVE_AT
  const previewing = step >= PREVIEW_AT
  const url = live ? target.host : 'localhost:3000'

  return (
    <div className="stage">
      <div className="window" aria-label="Demo: one sentence becoming a live app on your own account">
        <div className="window-bar" aria-hidden="true">
          <span className="lights">
            <i />
            <i />
            <i />
          </span>
          <span className="window-title">Ramu</span>
        </div>
        <div className="demo">
          <div className="demo-thread">
            <header className="thread-head">
              <span className="thread-title">Barbershop booking</span>
              <span className="thread-branch">main</span>
              <span key={previewing ? 'p' : 'b'} className={`thread-state${live ? ' is-live' : ''}`}>
                <span className="state-dot" aria-hidden="true" />
                {live ? 'Live' : previewing ? 'Preview running' : 'Building'}
              </span>
            </header>
            <ol className="thread-body" aria-live="polite">
              {all.slice(0, step + 1).map((s, i) => {
                if (s.kind === 'user')
                  return (
                    isSent && (
                      <li key={i} className="msg msg-user">
                        {s.text}
                      </li>
                    )
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
                      <span>Live at https://{target.host}. Every change from here comes as a pull request.</span>
                    </li>
                  )
                return (
                  <li key={i} className="msg msg-agent">
                    <span>{s.text}</span>
                  </li>
                )
              })}
            </ol>
            {/* The prompt is typed here, left to right as in the app, then sent into the thread. */}
            <div className="composer" aria-hidden="true">
              <span className={`composer-text${isSent ? ' is-empty' : ''}`}>
                {isSent ? 'Ask for a change…' : PROMPT.slice(0, chars)}
                {!isSent && <span className="caret" />}
              </span>
              <span className={`composer-send${!isSent && chars > 0 ? ' is-ready' : ''}`}>↑</span>
            </div>
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
                      <div
                        className="meter-track"
                        role="img"
                        aria-label={`${stage.label} ${done ? 'done' : 'not yet'}`}
                      >
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
      </div>

      {/* The app the thread built, as the browser panel shows it. */}
      <figure className={`float-site${previewing ? ' is-in' : ''}`} aria-hidden="true">
        <div className="site-bar">
          <span className={`site-lock${live ? ' is-live' : ''}`} />
          <span key={url} className="site-url">
            {live ? 'https://' : 'http://'}
            {url}
          </span>
        </div>
        <div className="site-page">
          <span className="site-brand">Fade &amp; Co.</span>
          <span className="site-h">Book your cut</span>
          <span className="site-slots">
            {SLOTS.map((slot) => (
              <i key={slot} className={slot === '15:30' ? 'is-on' : ''}>
                {slot}
              </i>
            ))}
          </span>
          <span className="site-cta">Book 15:30</span>
        </div>
      </figure>

      {/* The phone app hears about it too. */}
      <figure className="float-phone" aria-hidden="true">
        <div className="phone-notch" />
        <span className="phone-time">9:41</span>
        <span className="phone-date">Tuesday, 17 November</span>
        <div className="notes">
          {previewing && (
            <div className="note">
              <img src="/favicon.svg" alt="" width={18} height={18} />
              <span>
                <b>Barbershop booking</b>
                Preview is ready to try
              </span>
            </div>
          )}
          {live && (
            <div className="note">
              <img src="/favicon.svg" alt="" width={18} height={18} />
              <span>
                <b>Live on {target.name}</b>
                {target.host}
              </span>
            </div>
          )}
        </div>
      </figure>
    </div>
  )
}
