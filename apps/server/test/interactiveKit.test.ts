import { expect, it } from 'vitest'
import { resolveInteractiveKit, INTERACTIVE_KIT_CSS } from '../src/interactive/kit'
import { interactiveDocumentHtml } from '../src/interactive/store'

const base = { title: 'T', summary: 'S', checks: [] }

it('inlines Lucide icons with defaults the author can override', () => {
  const html = resolveInteractiveKit(
    '<button><svg data-icon="chevron-right"></svg>Next</button><svg data-icon="Trash2" width="20" aria-label="Delete"/>',
  )
  expect(html).toContain('<path d="m9 18 6-6-6-6"/></svg>Next</button>')
  expect(html).toMatch(
    /<svg data-icon="chevron-right" xmlns="http:\/\/www.w3.org\/2000\/svg" width="1em"[^>]*aria-hidden="true">/,
  )
  const trash = html.slice(html.indexOf('data-icon="Trash2"'))
  expect(trash).toContain('width="20"')
  expect(trash).not.toContain('width="1em"')
  expect(trash).not.toContain('aria-hidden')
  expect(trash).toMatch(/<\/svg>$/)
})

it('resolves an already-resolved document to the same bytes', () => {
  const once = resolveInteractiveKit(
    '<link rel="stylesheet" href="ramu:kit"><svg data-icon="check"></svg> <svg data-icon="x"></svg>',
  )
  expect(resolveInteractiveKit(once)).toBe(once)
  expect(once.match(/<path|<line/g)?.length).toBeGreaterThan(1)
})

it('replaces the kit link and leaves script, style and textarea text alone', () => {
  const source =
    '<link rel="stylesheet" href="ramu:kit"><script>const a = \'<svg data-icon="nope"></svg>\'</script><textarea><svg data-icon="nope"></svg></textarea><template><svg data-icon="check"></svg></template>'
  const html = resolveInteractiveKit(source)
  expect(html).toContain(`<style data-ramu-kit>${INTERACTIVE_KIT_CSS}</style>`)
  expect(html).toContain('const a = \'<svg data-icon="nope"></svg>\'')
  expect(html).toContain('<textarea><svg data-icon="nope"></svg></textarea>')
  expect(html).toMatch(/<template><svg data-icon="check"[^>]*><path/)
})

it('fails preview for unknown icons and built-ins with suggestions', () => {
  expect(() => resolveInteractiveKit('<svg data-icon="chevron-rite"></svg>')).toThrow(
    /Unknown icon "chevron-rite".*chevron-right/,
  )
  expect(() => resolveInteractiveKit('<link rel="stylesheet" href="ramu:charts">')).toThrow(
    'Unknown built-in ramu:charts',
  )
  expect(() => resolveInteractiveKit('<script src="ramu:kit"></script>')).toThrow('no ramu: script')
})

it('resolves the kit for single documents and bundled projects', () => {
  expect(interactiveDocumentHtml({ ...base, html: '<svg data-icon="check"></svg>' })).toContain('<path')
  const project = interactiveDocumentHtml({
    ...base,
    files: [{ path: 'index.html', content: '<link rel="stylesheet" href="ramu:kit"><svg data-icon="check"></svg>' }],
  })
  expect(project).toContain('data-ramu-kit')
  expect(project).toContain('<path')
})

it('rejects viewport height units in styles but not in scripts or prose', () => {
  expect(() => interactiveDocumentHtml({ ...base, html: '<style>.chart{height:60vh}</style>' })).toThrow(
    'Viewport height units (vh)',
  )
  expect(() => interactiveDocumentHtml({ ...base, html: '<div style="min-height: 100dvh"></div>' })).toThrow('dvh')
  expect(
    interactiveDocumentHtml({ ...base, html: '<p>Use 100vh carefully</p><script>const h = "50vh"</script>' }),
  ).toContain('100vh')
})
