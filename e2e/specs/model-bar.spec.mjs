import { startRamu, useFakeModel } from '../support/index.mjs'

const ramu = await startRamu('model-bar')
const { page, api, check } = ramu

ramu.test('a manually selected model keeps effort mode after starting a chat', async () => {
  await useFakeModel(ramu)
  await ramu.reload()
  const openControls = () => page.getByRole('button', { name: 'Model and effort controls', exact: true }).click()
  const effort = () => page.getByRole('button', { name: 'Effort only', exact: true })
  const steps = () => page.getByRole('button', { name: 'Model and effort', exact: true })

  await openControls()
  check((await steps().getAttribute('aria-pressed')) === 'true', 'Configured default starts in Step mode')
  await page.getByRole('button', { name: /^Select model ·/ }).click()
  await page.getByRole('textbox', { name: 'Search models', exact: true }).fill('fake-codex')
  await page.getByRole('menuitemradio').filter({ hasText: /codex/i }).first().click()
  check((await effort().getAttribute('aria-pressed')) === 'true', 'Manual model selection uses Effort mode')
  await page.keyboard.press('Escape')

  await page.locator('[data-composer-input]:visible').first().fill('Keep my manually selected model')
  await page.getByRole('button', { name: 'Start chat', exact: true }).click()
  await page.locator('.agent-view:visible[data-state="idle"] .msg.assistant').last().waitFor()
  await openControls()
  check((await effort().getAttribute('aria-pressed')) === 'true', 'Effort mode survives starting the chat')
  check(await page.getByRole('slider', { name: 'Reasoning effort level' }).isVisible(), 'Slider controls effort')
  await page.keyboard.press('Escape')

  await ramu.reload()
  await openControls()
  check((await effort().getAttribute('aria-pressed')) === 'true', 'Off-step model keeps Effort mode after reload')
  check((await api('settings.models.get')).defaultBarMode === 'effort', 'Selected mode is saved')
  await steps().click()
  await ramu.until(async () => (await api('settings.models.get')).defaultBarMode === 'model', 'Step mode saved')
  await effort().click()
  await ramu.until(
    async () => (await api('settings.models.get')).defaultBarMode === 'effort',
    'Explicit Effort mode saved',
  )
  await page.keyboard.press('Escape')
  await ramu.reload()
  await openControls()
  check((await effort().getAttribute('aria-pressed')) === 'true', 'Explicit Effort mode survives reload')
  ramu.noErrors()
})
