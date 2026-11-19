import { expect, it } from 'vitest'
import { docOutline } from '../src/pages/DocOutline'

it('lists a drawn doc’s headings with their anchors and plain text, skipping empty ones', () => {
  const html =
    '<article><h1 id="plan">Plan</h1><p>x</p><h2 id="risks-amp-costs">Risks &amp; <em>costs</em></h2>' +
    '<h3 id="q">Why &quot;now&quot;?</h3><h2 id="empty"><span></span></h2><h4>No anchor</h4></article>'
  expect(docOutline(html)).toEqual([
    { id: 'plan', text: 'Plan', level: 1 },
    { id: 'risks-amp-costs', text: 'Risks & costs', level: 2 },
    { id: 'q', text: 'Why "now"?', level: 3 },
  ])
})
