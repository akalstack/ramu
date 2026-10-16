// Settings dialog: providers and account profiles, background and update options, chat defaults, recap toggle.
import assert from 'node:assert/strict'
import { openSettings, saveSettings, startRamu } from '../support/index.mjs'

const ramu = await startRamu('settings')
const { page, check } = ramu
const switchNamed = (name) => page.getByRole('switch', { name, exact: true })

ramu.test('providers and account profiles', async () => {
  check(
    await page.getByRole('button', { name: 'Refresh recap', exact: true }).isVisible(),
    'Recaps are enabled by default on Home',
  )
  await openSettings(ramu, 'Providers & models')
  await page.locator('.provider-settings-card').first().waitFor()
  check((await page.locator('.provider-settings-card').count()) === 5, 'Provider settings keeps all five providers')
  check(
    (await page.getByRole('button', { name: /Install & setup|Update & setup/ }).count()) === 0,
    'Provider settings removes install/setup panels',
  )
  // Login rows only exist for providers installed on this machine, so compare buttons with rows instead of assuming a count.
  check(
    (await page.getByRole('button', { name: /^(Login|Switch login)$/ }).count()) ===
      (await page.locator('ul[aria-label$=" logins"] > li').count()),
    'Every installed provider login row exposes Login',
  )
  check(
    (await page.getByRole('button', { name: 'Add account', exact: true }).count()) === 5,
    'Account profiles are offered for every provider',
  )
  const codex = page.getByRole('region', { name: 'Codex settings', exact: true })
  await codex.getByRole('button', { name: 'Add account', exact: true }).click()
  await codex.getByRole('textbox', { name: 'Account name', exact: true }).fill('Smoke account')
  await codex.getByRole('button', { name: 'Add', exact: true }).click()
  const account = codex.getByRole('combobox', { name: 'Codex account', exact: true })
  check((await account.textContent()).includes('Smoke account'), 'A new account profile can be named and selected')
  await account.click()
  await page.getByRole('option', { name: 'Default CLI account', exact: true }).click()
  await ramu.shot('provider-settings')
})

ramu.test('background, update and keep-awake options', async () => {
  await page.getByRole('button', { name: 'Background & updates', exact: true }).click()
  check((await switchNamed('Auto-update Ramu').count()) === 0, 'App auto-update is unavailable for unsigned builds')
  check(await switchNamed('Check app updates').isChecked(), 'GitHub app-update checks are on by default')
  await ramu.shot('app-updates')
  const awake = switchNamed('Keep computer awake')
  check(!(await awake.isChecked()), 'Keep awake defaults off before service installation')
  await awake.check()
  const source = page.getByRole('combobox', { name: 'When to keep awake', exact: true })
  check((await source.textContent()).includes('Plugged in only'), 'Keep awake recommends plugged-in-only power')
  await source.click()
  await page.getByRole('option', { name: 'Plugged in and on battery', exact: true }).click()
  check((await source.textContent()).includes('on battery'), 'Keep awake also offers battery operation')
  await source.click()
  await page.getByRole('option', { name: 'Plugged in only (recommended)', exact: true }).click()
  await awake.uncheck()
})

ramu.test('thread defaults and the recap toggle', async () => {
  await page.getByRole('button', { name: 'Threads', exact: true }).click()
  check(
    await switchNamed('Continue threads after restart').isChecked(),
    'Thread continuation after restart is on by default',
  )
  check(await switchNamed('Keep working while asking questions').isChecked(), 'Async questions are on by default')
  await page.getByRole('button', { name: 'Background & updates', exact: true }).click()
  await page.getByRole('switch', { name: /Daily recaps/ }).uncheck()
  await saveSettings(ramu)
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  check(
    (await page.getByRole('button', { name: 'Refresh recap', exact: true }).count()) === 0,
    'Recap toggle hides Home recaps',
  )
  await openSettings(ramu, 'Threads')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('.settings-page').waitFor({ state: 'detached' })
  ramu.noErrors()
})

ramu.test('Reduce motion persists, survives a reload and removes pane transitions', async () => {
  const motionOff = () => page.evaluate(() => !document.documentElement.hasAttribute('data-reduce-motion'))
  assert.ok(await motionOff(), 'motion is on by default')
  await openSettings(ramu, 'Appearance')
  await switchNamed('Reduce motion').check()
  await saveSettings(ramu)
  await ramu.until(async () => (await ramu.api('settings.app.get')).reduceMotion === true, 'Reduce motion never saved')
  await ramu.reload()
  assert.ok(!(await motionOff()), 'the attribute is restored after a reload')
  // With it on, no element keeps a transition or animation duration.
  assert.equal(
    await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('.shell'))
      return [style.transitionDuration, style.animationDuration].every((value) => /^0(\.0+)?m?s$/.test(value))
    }),
    true,
    'transitions are disabled',
  )
  await openSettings(ramu, 'Appearance')
  await switchNamed('Reduce motion').uncheck()
  await saveSettings(ramu)
  ramu.noErrors()
})
