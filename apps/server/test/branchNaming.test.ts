import { afterEach, expect, it, vi } from 'vitest'
import { generateBranchName } from '../src/workspace/branchNaming'
const intent = { strategy: 'semantic' as const, instructions: '', prompt: 'Fix login timeout' }
afterEach(() => vi.useRealTimers())
it('accepts complete semantic/custom names without stacking a fixed prefix', async () => {
  expect(await generateBranchName('Login', intent, async () => 'fix/login-timeout\n')).toEqual({
    name: 'fix/login-timeout',
    source: 'generated',
  })
  const analyze = vi.fn(async (_prompt: string) => 'ABC-123/login')
  expect(
    await generateBranchName('Login', { ...intent, strategy: 'custom', instructions: 'Use ABC-123/' }, analyze),
  ).toEqual({ name: 'ABC-123/login', source: 'generated' })
  expect(analyze.mock.calls[0]?.[0]).toContain('Use ABC-123/')
})
it('falls back deterministically for invalid output, errors and unavailable providers', async () => {
  for (const output of ['Here is fix/login', 'fix/../login', '```fix/login```', 'HEAD', 'fix/' + 'a'.repeat(170)]) {
    expect(await generateBranchName('Login', intent, async () => output)).toEqual({
      name: 'ramu/login',
      source: 'fallback',
    })
  }
  expect(
    await generateBranchName('Login', intent, async () => {
      throw new Error('limit')
    }),
  ).toEqual({ name: 'ramu/login', source: 'fallback' })
})
it('bounds model input and aborts a stuck analysis at the deadline', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  let prompt = ''
  const result = generateBranchName(
    'Login',
    { ...intent, prompt: 'x'.repeat(100000), instructions: 'y'.repeat(100000), strategy: 'custom' },
    async (p, s) => {
      prompt = p
      signal = s
      return new Promise<string>(() => {})
    },
    50,
  )
  await vi.advanceTimersByTimeAsync(50)
  expect(await result).toEqual({ name: 'ramu/login', source: 'fallback' })
  expect(signal?.aborted).toBe(true)
  expect(prompt.length).toBeLessThan(9000)
})
it('cancels abandoned generation and skips an already cancelled request', async () => {
  const controller = new AbortController()
  let signal: AbortSignal | undefined
  const analyze = vi.fn(async (_prompt: string, active: AbortSignal) => {
    signal = active
    return new Promise<string>(() => {})
  })
  const pending = generateBranchName('Login', intent, analyze, 15000, controller.signal)
  controller.abort()
  expect(await pending).toEqual({ name: 'ramu/login', source: 'fallback' })
  expect(signal?.aborted).toBe(true)
  await generateBranchName('Login', intent, analyze, 15000, controller.signal)
  expect(analyze).toHaveBeenCalledTimes(1)
})
