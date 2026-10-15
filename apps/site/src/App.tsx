import { useEffect, useMemo, useState } from 'react'
import { Backdrop } from './Backdrop'

const REPO = 'https://github.com/ahxar/ramu'
const RELEASES = `${REPO}/releases`

type Provider = { id: string; name: string; logo: string; signIn: string }

const PROVIDERS: Provider[] = [
  { id: 'claude', name: 'Claude Code', logo: '/providers/claude.svg', signIn: 'Install Claude Code and sign in' },
  { id: 'codex', name: 'Codex', logo: '/providers/openai.svg', signIn: 'Install Codex and sign in' },
  {
    id: 'opencode',
    name: 'OpenCode',
    logo: '/providers/opencode.svg',
    signIn: 'opencode acp, with your model provider',
  },
  { id: 'cursor', name: 'Cursor', logo: '/providers/cursor.svg', signIn: 'agent login' },
  {
    id: 'antigravity',
    name: 'Antigravity',
    logo: '/providers/antigravity.svg',
    signIn: 'Google sign-in from Settings',
  },
]

const byId = (id: string) => PROVIDERS.find((p) => p.id === id)!

function Logo({ provider, size = 28 }: { provider: Provider; size?: number }) {
  return (
    <span className="logo-tile" style={{ width: size, height: size }}>
      <img src={provider.logo} alt="" width={size * 0.64} height={size * 0.64} />
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Hero demo: a thread that moves to the next provider at a limit.     */
/* ------------------------------------------------------------------ */

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

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
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
      <Logo provider={provider} size={26} />
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

function Demo() {
  const reduced = useReducedMotion()
  const [startId, setStartId] = useState('claude')
  const [run, setRun] = useState(0)
  const [step, setStep] = useState(reduced ? STEPS.length - 1 : 0)

  const order = useMemo(() => {
    const rest = PROVIDERS.filter((p) => p.id !== startId && ['claude', 'codex', 'cursor'].includes(p.id))
    return [byId(startId), rest[0]!, rest[1]!]
  }, [startId])

  useEffect(() => {
    if (reduced) {
      setStep(STEPS.length - 1)
      return
    }
    setStep(0)
    const timers = STEPS.slice(1).map((_, i) =>
      window.setTimeout(() => setStep(i + 1), 900 * (i + 1) + (i >= 3 ? 700 : 0)),
    )
    return () => timers.forEach(window.clearTimeout)
  }, [startId, run, reduced])

  const [first, second] = order as [Provider, Provider, Provider]
  const switched = step >= 4
  const finished = step >= STEPS.length - 1
  const current = switched ? second : first

  return (
    <div className="demo" aria-label="Demo: an agent thread continuing on a second provider">
      <div className="demo-thread">
        <header className="thread-head">
          <span className="thread-title">Rate limit /v1/quote</span>
          <span className="thread-branch">feat/rate-limit</span>
          <span className="thread-model" key={current.id}>
            <Logo provider={current} size={20} />
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
                    {first.name} reached its usage limit. Continuing on {second.name} with the same chat.
                  </span>
                </li>
              )
            const who = order[s.who]!
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
                <Logo provider={who} size={20} />
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
            {['claude', 'codex', 'cursor'].map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={startId === id}
                className={startId === id ? 'is-on' : ''}
                onClick={() => setStartId(id)}
              >
                {byId(id).name}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="replay"
            onClick={() => setRun((n) => n + 1)}
            disabled={!finished && !reduced}
          >
            Replay
          </button>
        </div>
      </aside>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function Nav() {
  return (
    <header className="nav">
      <div className="nav-inner">
        <a className="nav-brand" href="#top" aria-label="Ramu home">
          <img src="/wordmark.svg" alt="Ramu" height={22} />
        </a>
        <nav className="nav-links" aria-label="Primary">
          <a href="#providers">Providers</a>
          <a href="#work">Work</a>
          <a href="#review">Review</a>
          <a href={`${REPO}#guides`}>Docs</a>
          <a className="nav-cta" href="#download">
            Download
          </a>
        </nav>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="hero" id="top">
      <Backdrop />
      <h1>Keep coding when your agent hits its limit.</h1>
      <p className="hero-sub">
        One desktop workspace for Claude Code, Codex, OpenCode, Cursor, and Antigravity, with your editor, terminals,
        and Git. When a provider runs out, the chat moves to the next one.
      </p>
      <div className="hero-actions">
        <a className="btn btn-primary" href="#download">
          Download for macOS
        </a>
        <a className="btn btn-quiet" href={REPO}>
          Read the source
        </a>
        <span className="hero-note">Open source alpha for macOS and Linux</span>
      </div>
      <Demo />
    </section>
  )
}

function Providers() {
  return (
    <section className="section" id="providers">
      <div className="section-head">
        <h2>Use the subscriptions you already have</h2>
        <p>
          Each agent runs through its own installed runtime and signs in as usual. Ramu doesn’t resell tokens or store
          passwords. <em>Ramu</em> is Indonesian for blending ingredients into one.
        </p>
      </div>
      <ul className="ingredients">
        {PROVIDERS.map((p) => (
          <li key={p.id}>
            <Logo provider={p} size={40} />
            <div>
              <h3>{p.name}</h3>
              <p>{p.signIn}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

const WORK = [
  {
    title: 'Ask a second opinion',
    body: 'Your agent can ask a model from another provider to check its approach and review the result.',
  },
  {
    title: 'Hand tasks to helpers',
    body: 'Send delegated work to another provider by task type. Follow progress, read transcripts, or use an isolated checkout.',
  },
  {
    title: 'Set a goal, step away',
    body: 'Goals span many turns and survive provider changes. Pause, resume, or cap them. Start one with /goal.',
  },
  {
    title: 'Remember across providers',
    body: 'Shared notes carry project knowledge and your preferences between agents, with version history.',
  },
  {
    title: 'Close the window',
    body: 'Chats and terminals keep running. Schedule tasks, resume after a restart, and catch up from recaps.',
  },
]

function Work() {
  return (
    <section className="section section-split" id="work">
      <div className="section-head sticky">
        <h2>Work that keeps going</h2>
        <p>Background work needs your computer awake. Provider capabilities vary.</p>
      </div>
      <ul className="rows">
        {WORK.map((w) => (
          <li key={w.title}>
            <h3>{w.title}</h3>
            <p>{w.body}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Review() {
  return (
    <section className="section section-split" id="review">
      <div className="section-head">
        <h2>Review every change, undo any of them</h2>
        <p>
          Ramu records the diff for each turn. Comment on lines, then undo selectively, with a conflict check if you
          edited the same lines since.
        </p>
        <ul className="checks">
          <li>Monaco editor and split terminals beside the chat</li>
          <li>Branches, staging, stashes, and sync</li>
          <li>Unsent drafts kept per chat across restarts</li>
        </ul>
      </div>
      <figure className="diff" aria-label="Example diff with a review comment">
        <figcaption>
          <span>src/middleware/limit.ts</span>
          <span className="diff-stat">
            <b className="add">+42</b> <b className="del">−3</b>
          </span>
        </figcaption>
        <pre>
          <code>
            <span className="ln ctx">
              <i>12</i>
              {'export function limit(opts: LimitOptions) {'}
            </span>
            <span className="ln del">
              <i>13</i>
              {'  const windowMs = 1000'}
            </span>
            <span className="ln add">
              <i>13</i>
              {'  const windowMs = opts.windowMs ?? 60_000'}
            </span>
            <span className="ln add">
              <i>14</i>
              {'  const hits = new Map<string, number[]>()'}
            </span>
            <span className="ln ctx">
              <i>15</i>
              {'  return async (req, res, next) => {'}
            </span>
          </code>
        </pre>
        <div className="comment">
          <b>You</b> Key by API key, not IP. Several customers share one proxy.
          <div className="comment-actions">
            <span>Sent to Codex</span>
            <button type="button" tabIndex={-1}>
              Undo this change
            </button>
          </div>
        </div>
      </figure>
    </section>
  )
}

function Source() {
  return (
    <section className="section section-split" id="source">
      <div className="section-head">
        <h2>MIT licensed. Fork it.</h2>
        <p>Electron, React, TypeScript, Monaco, and xterm.js. The background service also runs headless.</p>
        <a className="btn btn-quiet" href={REPO}>
          Browse the source
        </a>
      </div>
      <div className="terminal" role="img" aria-label="Terminal commands to run Ramu from source">
        <pre>
          <code>
            <span className="t-dim">$ </span>git clone https://github.com/ahxar/ramu.git{'\n'}
            <span className="t-dim">$ </span>cd ramu{'\n'}
            <span className="t-dim">$ </span>pnpm install --frozen-lockfile{'\n'}
            <span className="t-dim">$ </span>pnpm dev{'\n'}
            <span className="t-ok">ready</span> <span className="t-dim">Node 24, pnpm 11.21.0</span>
          </code>
        </pre>
      </div>
    </section>
  )
}

function Download() {
  return (
    <section className="download" id="download">
      <div className="download-inner">
        <h2>Try the alpha</h2>
        <p>
          Installers and SHA-256 checksums are on GitHub Releases. Alpha builds are unsigned, so install updates
          manually.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href={RELEASES}>
            macOS (Apple silicon and Intel)
          </a>
          <a className="btn btn-quiet" href={RELEASES}>
            Linux x64
          </a>
        </div>
        <p className="download-fine">
          Linux GUI validation is pending. Windows is experimental. Sign in to a provider first; see the{' '}
          <a href={`${REPO}/blob/main/docs/PROVIDERS.md`}>provider setup guide</a>.
        </p>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <img src="/ramu-logo.svg" alt="Ramu" height={22} />
      <span>MIT licensed. Provider names and logos belong to their owners.</span>
      <nav aria-label="Footer">
        <a href={REPO}>GitHub</a>
        <a href={RELEASES}>Releases</a>
        <a href={`${REPO}/blob/main/CONTRIBUTING.md`}>Contributing</a>
        <a href={`${REPO}/blob/main/SECURITY.md`}>Security</a>
      </nav>
    </footer>
  )
}

export function App() {
  return (
    <>
      <a className="skip" href="#work">
        Skip to content
      </a>
      <Nav />
      <main>
        <Hero />
        <Providers />
        <Work />
        <Review />
        <Source />
        <Download />
      </main>
      <Footer />
    </>
  )
}
