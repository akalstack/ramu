import { expect, it } from 'vitest'
import { parseArtifactSource } from '@ramu/shared/artifactSource'
import { motionSeconds, renderMotion } from '../src/interactive/motion'

const motion = (scenes: unknown) => parseArtifactSource({ kind: 'motion', scenes })

it('keeps a motion within two minutes and twenty scenes', () => {
  expect(() => motion([])).toThrow('at least one scene')
  expect(() => motion(Array.from({ length: 5 }, () => ({ seconds: 30, html: '<p>x</p>' })))).toThrow(
    'at most 120 seconds',
  )
})

it('plays scenes once in order with CSS alone, each starting when the one before ends', () => {
  const source = motion([
    { seconds: 4, html: '<h1>Sync</h1>', css: 'h1{animation:rise 1s var(--scene-start) both}' },
    { seconds: 6, html: '<p>How it works</p>' },
  ])
  if (source.kind !== 'motion') throw new Error('not a motion')
  expect(motionSeconds(source)).toBe(10)
  const drawn = renderMotion(source, 'Sync explainer')
  expect(drawn.html).toContain('animation:ramu-scene-0 10s linear forwards;--scene-start:0s')
  expect(drawn.html).toContain('--scene-start:4s')
  expect(drawn.html).toContain('@scope ([data-ramu-scene="0"])')
  expect(drawn.html).toContain('Sync explainer, 10 seconds')
  expect(drawn.html).not.toContain('<script')
})
