import { describe, expect, it } from 'vitest'
import { elicitationRequest, elicitationContent } from '../src/agent/elicitation'
const form = (properties: Record<string, unknown>, required: string[] = []) => ({
  mode: 'form',
  serverName: 'Demo server',
  message: 'Choose a setup',
  requestedSchema: { type: 'object', properties, required },
})
describe('MCP elicitation forms', () => {
  it('preserves typed values, optional omissions, defaults and titled choices', () => {
    const request = elicitationRequest(
      '1',
      form(
        {
          title: { type: 'string', minLength: 2, default: 'Draft' },
          count: { type: 'integer', minimum: 1, maximum: 10 },
          enabled: { type: 'boolean', default: false },
          mode: {
            type: 'string',
            oneOf: [
              { const: 'fast', title: 'Fast mode' },
              { const: 'safe', title: 'Safe mode' },
            ],
          },
          tags: {
            type: 'array',
            items: {
              anyOf: [
                { const: 'a,b', title: 'Comma value' },
                { const: 'two', title: 'Two' },
              ],
            },
            minItems: 1,
            maxItems: 2,
          },
          note: { type: 'string' },
        },
        ['title', 'count', 'enabled', 'mode', 'tags'],
      ),
    )
    expect(request.fields.find((field) => field.id === 'mode')?.options).toEqual([
      { value: 'fast', label: 'Fast mode' },
      { value: 'safe', label: 'Safe mode' },
    ])
    expect(request.fields.find((field) => field.id === 'enabled')?.defaultValue).toBe('false')
    expect(
      elicitationContent(request, {
        title: '  Name  ',
        count: '3',
        enabled: 'false',
        mode: 'safe',
        tags: '["a,b"]',
        note: '',
      }),
    ).toEqual({ title: '  Name  ', count: 3, enabled: false, mode: 'safe', tags: ['a,b'] })
  })
  it.each([{ age: '1.5' }, { age: '999' }, { age: 'NaN' }, { age: '' }, { age: '2', unexpected: 'value' }])(
    'rejects invalid input without coercing it: %j',
    (answers) => {
      const request = elicitationRequest('1', form({ age: { type: 'integer', minimum: 1, maximum: 20 } }, ['age']))
      expect(() => elicitationContent(request, answers as Record<string, string>)).toThrow()
    },
  )
  it('validates formats and enum membership, including legacy display labels', () => {
    const request = elicitationRequest(
      '1',
      form(
        {
          email: { type: 'string', format: 'email' },
          choice: { type: 'string', enum: ['a', 'b'], enumNames: ['First', 'Second'] },
        },
        ['email', 'choice'],
      ),
    )
    expect(request.fields[1]?.options[0]).toEqual({ value: 'a', label: 'First' })
    expect(() => elicitationContent(request, { email: 'invalid', choice: 'a' })).toThrow()
    expect(() => elicitationContent(request, { email: 'me@example.com', choice: 'First' })).toThrow()
    expect(elicitationContent(request, { email: 'me@example.com', choice: 'b' })).toEqual({
      email: 'me@example.com',
      choice: 'b',
    })
  })
  it('accepts empty forms, primitive empty strings and safe URL requests only after explicit submission', () => {
    expect(elicitationContent(elicitationRequest('1', form({})), {})).toEqual({})
    expect(
      elicitationContent(elicitationRequest('1', form({ name: { type: 'string' } }, ['name'])), { name: '' }),
    ).toEqual({ name: '' })
    const url = elicitationRequest('2', {
      mode: 'url',
      serverName: 'Auth',
      message: 'Sign in',
      url: 'https://example.com/auth',
      elicitationId: 'auth-1',
    })
    expect(url).toMatchObject({ mode: 'url', url: 'https://example.com/auth' })
    expect(elicitationContent(url, {})).toBeNull()
    expect(() =>
      elicitationRequest('3', {
        mode: 'url',
        serverName: 'Auth',
        message: 'Sign in',
        url: 'javascript:alert(1)',
        elicitationId: 'auth-2',
      }),
    ).toThrow()
  })
  it('does not silently ignore unsupported nested schemas or constraints', () => {
    expect(() => elicitationRequest('1', form({ nested: { type: 'object', properties: {} } }))).toThrow()
    expect(() => elicitationRequest('1', form({ custom: { type: 'string', pattern: 'abc' } }))).toThrow()
    expect(() => elicitationRequest('1', form({ toggle: { type: 'boolean', enum: [true] } }))).toThrow()
    expect(() =>
      elicitationRequest(
        '1',
        form({ choice: { type: 'string', oneOf: [{ const: 'a', title: 'A', not: { const: 'a' } }] } }),
      ),
    ).toThrow()
    expect(() =>
      elicitationContent(elicitationRequest('1', form({ name: { type: 'string' } }, ['name'])), {}),
    ).toThrow()
    expect(() => elicitationRequest('1', form({}, ['missing']))).toThrow()
  })
})
