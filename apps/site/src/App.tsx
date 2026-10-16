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
    signIn: 'Connect your model provider',
  },
  { id: 'cursor', name: 'Cursor', logo: '/providers/cursor.svg', signIn: 'Sign in with your Cursor account' },
  {
    id: 'antigravity',
    name: 'Antigravity',
    logo: '/providers/antigravity.svg',
    signIn: 'Sign in with Google in Settings',
  },
]

const byId = (id: string) => PROVIDERS.find((p) => p.id === id)!

function Logo({ provider, size = 28 }: { provider: Provider; size?: number }) {
  const monochrome = ['claude', 'codex', 'cursor'].includes(provider.id)
  const iconSize = size * (provider.id === 'codex' ? 0.88 : 0.64)

  return (
    <span className={`logo-tile logo-${provider.id}`} style={{ width: size, height: size }} aria-hidden="true">
      {monochrome ? (
        <span
          className="logo-mark"
          style={{ width: iconSize, height: iconSize, maskImage: `url("${provider.logo}")` }}
        />
      ) : (
        <img src={provider.logo} alt="" width={iconSize} height={iconSize} />
      )}
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
                    {first.name} reached its usage limit. Continuing on {second.name} with the same thread.
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
          <a href="#work">Features</a>
          <a href="#review">Review</a>
          <a href="#mobile">Mobile</a>
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
      <h1>Keep your agents moving.</h1>
      <p className="hero-sub">
        Bring your coding agents, editor, terminals, and Git together. Keep work moving across provider limits, carry
        context between models, and continue from your phone.
      </p>
      <div className="hero-actions">
        <a className="btn btn-primary" href="#download">
          Get Ramu
        </a>
        <a className="btn btn-quiet" href={REPO}>
          Read the source
        </a>
        <span className="hero-note">MIT licensed · Desktop + iOS and Android companion</span>
      </div>
      <Demo />
    </section>
  )
}

function Providers() {
  return (
    <section className="section" id="providers">
      <div className="section-head">
        <h2>Your agents. Your existing accounts.</h2>
        <p>
          Use Claude Code, Codex, OpenCode, Cursor, and Antigravity in one workspace. Connect your provider accounts and
          choose the right model for each task.
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
    title: 'Keep going through usage limits',
    body: 'Set your preferred provider order. Ramu switches with visible thread context when a limit is reached. If all are limited, it waits and resumes when capacity returns, even after a restart.',
  },
  {
    title: 'Get another model’s perspective',
    body: 'Let your agent consult a second model for advice and review. Delegate tasks to helpers across providers, with optional isolated checkouts.',
  },
  {
    title: 'Give longer tasks a goal',
    body: 'Keep an objective moving across turns and provider changes. Pause, resume, and set continuation limits so you stay in control.',
  },
  {
    title: 'Carry knowledge between agents',
    body: 'Share project knowledge and preferences across providers. Read, edit, and restore earlier versions of your notes.',
  },
  {
    title: 'Turn finished work into lessons',
    body: 'Capture reusable skills and lessons from completed tasks. Choose automatic updates or review them first, with revision history.',
  },
  {
    title: 'Leave work running',
    body: 'Threads and terminals keep running when you close the window. Schedule recurring tasks, recover unfinished threads after a restart, and catch up with recaps.',
  },
]

function Work() {
  return (
    <section className="section section-split" id="work">
      <div className="section-head sticky">
        <h2>Less restarting. More finishing.</h2>
        <p>
          Keep the objective, conversation, and project knowledge together as the work continues. Your computer must
          stay awake. Provider capabilities vary.
        </p>
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
        <h2>See what changed. Decide what stays.</h2>
        <p>
          Review recorded changes for each turn and send inline feedback to your agent. Undo selected changes with
          conflict checks to protect later edits.
        </p>
        <ul className="checks">
          <li>Monaco editor and split terminals beside the thread</li>
          <li>Branches, staging, stashes, and sync</li>
          <li>Unsent drafts kept per thread across restarts</li>
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

function Mobile() {
  return (
    <section className="section section-split" id="mobile">
      <div className="section-head">
        <h2>Step away from your desk. Stay with the work.</h2>
        <p>
          Pair the iOS or Android companion with your computer. Follow live agent progress, send the next instruction,
          and respond when an agent needs you.
        </p>
        <a className="btn btn-quiet" href={`${REPO}/blob/main/apps/mobile/README.md`}>
          Set up mobile
        </a>
      </div>
      <div className="section-head">
        <ul className="checks">
          <li>Chat, choose models, and manage goals</li>
          <li>Review diffs and send comments to your agent</li>
          <li>Stage changes, commit, and sync with Git</li>
          <li>Use live terminals and switch between paired computers</li>
        </ul>
        <p>Agents run on your computer. Keep it awake and reachable while you connect from your phone.</p>
      </div>
    </section>
  )
}

function Source() {
  return (
    <section className="section section-split" id="source">
      <div className="section-head">
        <h2>Your workspace, open to build on.</h2>
        <p>
          MIT licensed, with a desktop app, mobile companion, and a workspace server you can run headless. Read the
          code, contribute, or make it your own.
        </p>
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
        <h2>Bring your next task to Ramu.</h2>
        <p>
          Download the desktop alpha, connect a provider, and open a repository. Add the mobile companion to keep up
          from your phone.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href={RELEASES}>
            macOS (Apple silicon and Intel)
          </a>
          <a className="btn btn-quiet" href={RELEASES}>
            Linux x64
          </a>
          <a className="btn btn-quiet" href={`${REPO}/blob/main/apps/mobile/README.md`}>
            iOS and Android setup
          </a>
        </div>
        <p className="download-fine">
          Installers and SHA-256 checksums are on GitHub Releases. macOS builds are unsigned and not notarized; install
          alpha updates manually. Linux GUI validation is pending. Windows is experimental, with no release downloads.
          See the <a href={`${REPO}/blob/main/docs/PROVIDERS.md`}>provider setup guide</a>.
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
        <Mobile />
        <Source />
        <Download />
      </main>
      <Footer />
    </>
  )
}
