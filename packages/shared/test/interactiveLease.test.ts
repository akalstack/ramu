import { expect, it, vi } from 'vitest'
import { claimInteractive } from '../src/interactiveLease'

it('stops the oldest running document once the renderer limit is exceeded', () => {
  const [a, b, c, d] = [vi.fn(), vi.fn(), vi.fn(), vi.fn()]
  const releaseA = claimInteractive(a, 3)
  claimInteractive(b, 3)
  const releaseC = claimInteractive(c, 3)
  expect(a).not.toHaveBeenCalled()
  claimInteractive(d, 3)
  expect(a).toHaveBeenCalledTimes(1)
  releaseA()
  releaseC()
  claimInteractive(a, 3)
  expect(b).not.toHaveBeenCalled()
  // The default keeps one running document, as mobile expects.
  claimInteractive(c)
  expect(b).toHaveBeenCalledTimes(1)
  expect(d).toHaveBeenCalledTimes(1)
  expect(a).toHaveBeenCalledTimes(2)
})
