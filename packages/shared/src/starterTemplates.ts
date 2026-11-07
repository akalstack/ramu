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
]
