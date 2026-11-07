// The starting points Ramu ships, one per kind it can draw without an agent: each is an ordinary source for its kind,
// checked by the same parsing and drawing as any artifact (see the starter template tests).
import type { ArtifactKind } from './artifacts'

export interface StarterTemplate {
  id: `starter:${string}`
  kind: Exclude<ArtifactKind, 'app'>
  title: string
  icon: string
  /** The tool input for its kind, without title or checks. */
  source: Record<string, unknown>
}

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    id: 'starter:weekly-report',
    kind: 'doc',
    title: 'Weekly report',
    icon: '📝',
    source: {
      source: [
        '## Highlights',
        '',
        '- What shipped this week',
        '- What people noticed',
        '',
        '## Numbers',
        '',
        '| Measure | This week | Last week |',
        '| --- | --- | --- |',
        '| Signups | 0 | 0 |',
        '',
        '## Next week',
        '',
        '- [ ] The most important thing',
        '- [ ] The next thing',
        '',
        '## Risks',
        '',
        'Anything that could slip, and what would help.',
        '',
      ].join('\n'),
    },
  },
  {
    id: 'starter:pitch-deck',
    kind: 'slides',
    title: 'Pitch deck',
    icon: '🎤',
    source: {
      slides: [
        { layout: 'title', title: 'Your product', body: 'One line on what it does', notes: 'Introduce yourself.' },
        { layout: 'content', title: 'The problem', body: '- Who has it\n- How often\n- What it costs them' },
        { layout: 'content', title: 'Our answer', body: '- What it does\n- Why it works\n- What is new' },
        {
          layout: 'chart',
          title: 'Traction',
          chart: {
            type: 'line',
            labels: ['Jan', 'Feb', 'Mar', 'Apr'],
            series: [{ name: 'Users', values: [10, 30, 70, 150] }],
          },
          body: 'Replace these with your own numbers.',
        },
        { layout: 'two-columns', title: 'Plan', columns: ['**Now**\n- First step', '**Next**\n- Second step'] },
        { layout: 'quote', body: 'A sentence from someone who uses it.', by: 'A happy user' },
      ],
      theme: { appearance: 'auto' },
    },
  },
  {
    id: 'starter:metrics-dashboard',
    kind: 'dashboard',
    title: 'Metrics dashboard',
    icon: '📊',
    source: {
      datasets: [
        {
          id: 'weekly',
          columns: ['week', 'signups', 'active'],
          rows: [
            ['W1', 12, 40],
            ['W2', 18, 46],
            ['W3', 25, 55],
          ],
        },
      ],
      figures: [
        { label: 'Signups', dataset: 'weekly', column: 'signups', aggregate: 'sum' },
        { label: 'Active this week', dataset: 'weekly', column: 'active', aggregate: 'last' },
      ],
      charts: [{ title: 'Signups by week', type: 'bar', dataset: 'weekly', x: 'week', y: ['signups'] }],
    },
  },
  {
    id: 'starter:flowchart',
    kind: 'diagram',
    title: 'Flowchart',
    icon: '🔀',
    source: {
      format: 'mermaid',
      source:
        'flowchart LR\n  A[Start] --> B{Decide}\n  B -->|Yes| C[Do it]\n  B -->|No| D[Wait]\n  C --> E[Done]\n  D --> B',
    },
  },
  {
    id: 'starter:landing-page',
    kind: 'design',
    title: 'Landing page',
    icon: '🖼️',
    source: {
      frames: [
        {
          name: 'Landing (desktop)',
          width: 1440,
          height: 900,
          css: 'main{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:24px;text-align:center;padding:0 160px;font-family:var(--font-sans)}h1{font-size:64px;margin:0;line-height:1.05}p{font-size:22px;color:var(--muted);margin:0;max-width:720px}a{background:var(--primary);color:#fff;padding:14px 28px;border-radius:var(--radius);text-decoration:none;font-weight:600}',
          html: '<main><h1>Say what it does in one line</h1><p>One or two sentences on who it is for and why it is better.</p><a>Get started</a></main>',
        },
        {
          name: 'Landing (phone)',
          width: 390,
          height: 844,
          css: 'main{display:flex;flex-direction:column;justify-content:center;height:100%;gap:16px;padding:0 24px;font-family:var(--font-sans)}h1{font-size:36px;margin:0;line-height:1.1}p{font-size:17px;color:var(--muted);margin:0}a{background:var(--primary);color:#fff;padding:12px 20px;border-radius:var(--radius);text-align:center;text-decoration:none;font-weight:600}',
          html: '<main><h1>Say what it does in one line</h1><p>One or two sentences on who it is for.</p><a>Get started</a></main>',
        },
      ],
    },
  },
  {
    id: 'starter:explainer',
    kind: 'motion',
    title: '30-second explainer',
    icon: '🎬',
    source: {
      scenes: [
        {
          seconds: 8,
          css: 'div{display:flex;align-items:center;justify-content:center;height:100%;font:600 64px var(--font-sans)}span{animation:rise .8s var(--scene-start) both}@keyframes rise{from{opacity:0;transform:translateY(24px)}}',
          html: '<div><span>The problem, in one line</span></div>',
        },
        {
          seconds: 10,
          css: 'ol{height:100%;margin:0;padding:0 15%;display:flex;flex-direction:column;justify-content:center;gap:20px;font:500 40px var(--font-sans)}li{animation:in .6s both}li:nth-child(1){animation-delay:var(--scene-start)}li:nth-child(2){animation-delay:calc(var(--scene-start) + 2s)}li:nth-child(3){animation-delay:calc(var(--scene-start) + 4s)}@keyframes in{from{opacity:0}}',
          html: '<ol><li>First, what happens</li><li>Then, what changes</li><li>Finally, what you get</li></ol>',
        },
        {
          seconds: 12,
          css: 'div{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;font-family:var(--font-sans)}strong{font-size:56px}span{font-size:28px;color:var(--muted)}',
          html: '<div><strong>Your product</strong><span>Try it today</span></div>',
        },
      ],
    },
  },
]
