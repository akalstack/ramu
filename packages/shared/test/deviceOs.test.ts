import { expect, it } from 'vitest'
import { guessForm, osLine, osMark } from '../src/deviceOs'

it('marks each device by its OS, Linux by its distribution, and nothing it does not know', () => {
  expect(osMark({ os: 'ios', form: 'phone' })).toBe('apple')
  expect(osMark({ os: 'ipados', form: 'tablet' })).toBe('apple')
  expect(osMark({ os: 'macos', form: 'computer' })).toBe('apple')
  expect(osMark({ os: 'android', form: 'tablet' })).toBe('android')
  expect(osMark({ os: 'linux', form: 'server', distro: 'ubuntu' })).toBe('ubuntu')
  expect(osMark({ os: 'linux', form: 'server', distro: 'rocky' })).toBe('redhat')
  expect(osMark({ os: 'linux', form: 'server', distro: 'gentoo' })).toBe('linux')
  expect(osMark({ os: 'unknown', form: 'computer' })).toBeNull()
  expect(osMark(undefined)).toBeNull()
})

it('names the hardware and the system in one line', () => {
  expect(osLine({ os: 'ios', form: 'phone', version: '26.1', model: 'iPhone 17 Pro' })).toBe('iPhone 17 Pro · iOS 26.1')
  expect(
    osLine({ os: 'linux', form: 'server', version: '24.04', distro: 'ubuntu', distroName: 'Ubuntu 24.04.1 LTS' }),
  ).toBe('Ubuntu 24.04.1 LTS')
  expect(osLine({ os: 'macos', form: 'computer' })).toBe('macOS')
  expect(osLine({ os: 'unknown', form: 'computer' })).toBeNull()
  expect(osLine(undefined)).toBeNull()
})

it('guesses the shape of a device that has not described itself from its name', () => {
  expect(guessForm('Ahmad’s iPhone')).toBe('phone')
  expect(guessForm('Galaxy Tab S9')).toBe('tablet')
  expect(guessForm('iPad Pro')).toBe('tablet')
  expect(guessForm('Studio')).toBe('computer')
})
