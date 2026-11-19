import { expect, it } from 'vitest'
import { designTexts, withDesignTexts } from '../src/designText'

const FRAME =
  '<main>\n  <h1>Fast &amp; calm</h1>\n  <style>h1{color:red}</style><!-- note --><p class="x">Pay <b>$9</b> a month</p>' +
  '<script>let a = "<b>no</b>"</script><a>Get started</a>&nbsp;\n</main>'

it('lists a frame’s words outside styles, scripts and comments, decoded', () => {
  expect(designTexts(FRAME)).toEqual(['Fast & calm', 'Pay', '$9', 'a month', 'Get started'])
})

it('puts the person’s words back in place, escaped, and keeps unchanged and emptied runs as they were', () => {
  const html = withDesignTexts(FRAME, ['Quick <and> calm', 'Pay', '$12', '', 'Start free'])
  expect(html).toContain('<h1>Quick &lt;and&gt; calm</h1>')
  expect(html).toContain('<p class="x">Pay <b>$12</b> a month</p>')
  expect(html).toContain('<a>Start free</a>&nbsp;\n</main>')
  expect(html).toContain('<style>h1{color:red}</style><!-- note -->')
  expect(html).toContain('<script>let a = "<b>no</b>"</script>')
  expect(() => withDesignTexts(FRAME, ['one'])).toThrow('changed while you were editing')
})
