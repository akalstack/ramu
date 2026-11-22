import { describe, expect, it } from 'vitest'
import {
  applyInlineUi,
  inlineUiActionMessage,
  latestSurfaces,
  parseInlineUiActionMessage,
  readPointer,
  writePointer,
  type InlineSurface,
} from '../src/chat/inlineUi'
import {
  checkComponent,
  childrenOf,
  evaluate,
  formatDate,
  pressButton,
  type InlineUiScope,
} from '../src/chat/inlineUiRuntime'

const form = [
  {
    version: '1.0',
    createSurface: {
      surfaceId: 'signup',
      catalogId: 'getramu.dev:inline/v1',
      components: [
        { id: 'root', component: 'Column', children: ['email', 'submit'] },
        { id: 'email', component: 'TextField', label: 'Email', value: { '@path': '/form/email' } },
        { id: 'submit_label', component: 'Text', text: 'Send' },
        {
          id: 'submit',
          component: 'Button',
          child: 'submit_label',
          variant: 'primary',
          action: {
            event: {
              name: 'submit',
              userMessage: { '@call': 'formatString', args: { value: 'Signed up ${/form/email}' } },
              context: { email: { '@path': '/form/email' }, plan: 'pro' },
            },
          },
          '@checks': [
            { condition: { '@call': 'email', args: { value: { '@path': '/form/email' } } }, message: 'Enter an email' },
          ],
        },
      ],
      dataModel: { form: { email: '' } },
    },
  },
]

const created = (): InlineSurface => {
  const result = applyInlineUi(new Map(), form)
  if (!result.ok) throw new Error(result.error)
  return result.surfaces[0]!
}
const scope = (model: Record<string, unknown>, extra: Partial<InlineUiScope> = {}): InlineUiScope => ({
  model,
  base: [],
  locale: 'en-US',
  ...extra,
})
const button = (surface: InlineSurface) => {
  const found = surface.components.find((c) => c.id === 'submit')
  if (found?.component !== 'Button') throw new Error('no button')
  return found
}

describe('applyInlineUi', () => {
  it('creates a card and changes it with later messages', () => {
    const surface = created()
    expect(surface.revision).toBe(1)
    const result = applyInlineUi(new Map([[surface.surfaceId, surface]]), [
      { version: '1.0', updateDataModel: { surfaceId: 'signup', path: '/form/email', value: 'a@b.co' } },
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 'signup',
          components: [{ id: 'submit_label', component: 'Text', text: 'Done' }],
        },
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [next] = result.surfaces
    expect(next!.revision).toBe(2)
    expect(next!.dataModel).toEqual({ form: { email: 'a@b.co' } })
    expect(next!.components.find((c) => c.id === 'submit_label')).toMatchObject({ text: 'Done' })
  })

  it('rejects a batch that would leave a card broken, keeping nothing from it', () => {
    const missingRoot = applyInlineUi(new Map(), [
      { version: '1.0', createSurface: { surfaceId: 'a', components: [{ id: 'x', component: 'Text', text: 'hi' }] } },
    ])
    expect(missingRoot).toMatchObject({ ok: false, error: expect.stringContaining('"root"') })
    const dangling = applyInlineUi(new Map(), [
      {
        version: '1.0',
        createSurface: { surfaceId: 'a', components: [{ id: 'root', component: 'Card', child: 'gone' }] },
      },
    ])
    expect(dangling).toMatchObject({ ok: false, error: expect.stringContaining('"gone"') })
    const cycle = applyInlineUi(new Map(), [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'a',
          components: [
            { id: 'root', component: 'Card', child: 'inner' },
            { id: 'inner', component: 'Column', children: ['root'] },
          ],
        },
      },
    ])
    expect(cycle).toMatchObject({ ok: false, error: expect.stringContaining('contains itself') })
  })

  it('refuses parts Ramu does not draw and catalogs it does not know', () => {
    const image = applyInlineUi(new Map(), [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'a',
          components: [{ id: 'root', component: 'Image', url: 'https://x.test/a.png' }],
        },
      },
    ])
    expect(image.ok).toBe(false)
    const catalog = applyInlineUi(new Map(), [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'a',
          catalogId: 'example.com:other',
          components: [{ id: 'root', component: 'Text', text: 'hi' }],
        },
      },
    ])
    expect(catalog).toMatchObject({ ok: false, error: expect.stringContaining('catalogId') })
  })

  it('needs createSurface before updates and a new id for a new card', () => {
    expect(
      applyInlineUi(new Map(), [{ version: '1.0', updateDataModel: { surfaceId: 'nope', value: {} } }]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('createSurface') })
    const surface = created()
    expect(applyInlineUi(new Map([['signup', surface]]), form)).toMatchObject({
      ok: false,
      error: expect.stringContaining('already exists'),
    })
  })

  it('deletes a card, and the newest event per card wins', () => {
    const surface = created()
    const result = applyInlineUi(new Map([['signup', surface]]), [
      { version: '1.0', deleteSurface: { surfaceId: 'signup' } },
    ])
    expect(result).toMatchObject({ ok: true, surfaces: [{ deleted: true, revision: 2 }] })
    if (!result.ok) return
    const latest = latestSurfaces([
      { kind: 'inline-ui', surface },
      { kind: 'text' },
      { kind: 'inline-ui', surface: result.surfaces[0]! },
    ])
    expect(latest.get('signup')?.deleted).toBe(true)
  })
})

describe('pointers', () => {
  it('writes copies, deletes with null and ignores prototype keys', () => {
    const model = { a: { b: 1 } }
    const next = writePointer(model, ['a', 'c'], 2)
    expect(model).toEqual({ a: { b: 1 } })
    expect(next).toEqual({ a: { b: 1, c: 2 } })
    expect(writePointer(next, ['a', 'b'], null)).toEqual({ a: { c: 2 } })
    expect(writePointer({}, ['__proto__', 'polluted'], true)).toEqual({})
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(readPointer({ list: ['x', 'y'] }, ['list', '1'])).toBe('y')
  })
})

describe('runtime', () => {
  it('keeps a button disabled until its checks pass, then sends the resolved action', () => {
    const surface = created()
    expect(checkComponent(button(surface), scope({ form: { email: 'nope' } }))).toEqual({
      valid: false,
      message: 'Enter an email',
    })
    expect(pressButton(surface, button(surface), scope({ form: { email: 'nope' } }))).toEqual({ kind: 'none' })
    const outcome = pressButton(surface, button(surface), scope({ form: { email: 'a@b.co' } }), new Date(0))
    expect(outcome).toEqual({
      kind: 'event',
      action: {
        name: 'submit',
        surfaceId: 'signup',
        sourceComponentId: 'submit',
        timestamp: '1970-01-01T00:00:00.000Z',
        context: { email: 'a@b.co', plan: 'pro' },
        userMessage: 'Signed up a@b.co',
      },
    })
  })

  it('opens only web links from a button', () => {
    const surface = created()
    const linkButton = (url: string) => ({
      ...button(surface),
      '@checks': undefined,
      action: { functionCall: { '@call': 'openUrl', args: { url } } },
    })
    expect(pressButton(surface, linkButton('https://getramu.dev'), scope({}))).toEqual({
      kind: 'open',
      url: 'https://getramu.dev/',
    })
    expect(pressButton(surface, linkButton('javascript:alert(1)'), scope({}))).toEqual({ kind: 'none' })
    expect(pressButton(surface, linkButton('file:///etc/passwd'), scope({}))).toEqual({ kind: 'none' })
  })

  it('repeats a template over a list with relative paths and @index', () => {
    const model = { people: [{ name: 'Ayu' }, { name: 'Bo' }] }
    const children = childrenOf({ componentId: 'row', path: '/people' }, scope(model))
    expect(children.map((child) => child.key)).toEqual(['row:0', 'row:1'])
    const second = scope(model, { base: children[1]!.base, index: children[1]!.index })
    expect(evaluate({ '@path': 'name' }, second)).toBe('Bo')
    expect(evaluate({ '@call': '@index', args: { offset: 1 } }, second)).toBe(2)
    expect(evaluate({ '@call': 'formatString', args: { value: '${name} \\${x}' } }, second)).toBe('Bo ${x}')
  })

  it('formats numbers, plurals and dates in the reader’s language', () => {
    const s = scope({ n: 1234.5, count: 1 })
    expect(evaluate({ '@call': 'formatNumber', args: { value: { '@path': '/n' }, decimals: 1 } }, s)).toBe('1,234.5')
    expect(evaluate({ '@call': 'formatCurrency', args: { value: 3, currency: 'USD' } }, s)).toBe('$3.00')
    expect(
      evaluate({ '@call': 'pluralize', args: { value: { '@path': '/count' }, one: 'file', other: 'files' } }, s),
    ).toBe('file')
    expect(formatDate(new Date(2026, 0, 16, 14, 30), "MMM dd, yyyy 'at' h:mm a", 'en-US')).toBe(
      'Jan 16, 2026 at 2:30 PM',
    )
    expect(formatDate('not a date', 'yyyy', 'en-US')).toBe('')
  })
})

describe('action messages', () => {
  it('carry the A2UI action to the agent and read back as what the person did', () => {
    const text = inlineUiActionMessage({
      name: 'submit',
      surfaceId: 'signup',
      sourceComponentId: 'submit',
      timestamp: '1970-01-01T00:00:00.000Z',
      context: { email: 'a@b.co' },
      userMessage: 'Signed up',
    })
    expect(text).toContain('"version":"1.0"')
    expect(text).toContain('"context":{"email":"a@b.co"}')
    expect(parseInlineUiActionMessage(text)).toEqual({ surfaceId: 'signup', summary: 'Signed up' })
    expect(parseInlineUiActionMessage('hello')).toBeNull()
  })
})
