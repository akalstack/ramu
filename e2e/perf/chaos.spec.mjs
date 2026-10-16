// Chaos / QA pass: throws hostile input (see chaos-payloads.mjs) at every text surface of the built app and reports
// crashes, renderer exceptions, dead UI, layout overflow and rejected-without-explanation submits. Each surface is its own
// test and records findings instead of stopping at the first one; the last test fails when there are any.
// On demand: `pnpm test:e2e:perf chaos` (RAMU_CHAOS_SURFACES=scm,search runs only those surfaces after setup). Screenshots and findings.json land in e2e/output/chaos.
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { git, modifier, palette, startRamu } from '../support/index.mjs'
import { CORE, PAYLOADS, pick } from './chaos-payloads.mjs'

const PWNED = '/tmp/ramu-chaos-pwned'
rmSync(PWNED, { force: true })
// Folder and repo names contain a space on purpose.
const ramu = await startRamu('chaos', {
  env: ({ dir }) => ({ RAMU_TEST_PICK_DIRECTORY: join(dir, 'chaos work') }),
  repos: {
    'chaos work/web app': { 'README.md': '# web\n', 'src/App.tsx': 'export const App = 1\n' },
    'chaos work/api': [
      { 'README.md': '# api\n', 'src/server.ts': 'export const port = 3000\n' },
      { branch: 'develop' },
    ],
  },
})
const { page, sleep } = ramu
const web = ramu.repos['chaos work/web app']

const findings = []
const seen = new Set()
let current = 'setup'
const report = (kind, detail, payload = '') => {
  const key = `${current}|${kind}|${payload}|${String(detail).slice(0, 120)}`
  if (seen.has(key)) return
  seen.add(key)
  findings.push({ surface: current, kind, payload, detail: String(detail).slice(0, 400) })
  console.log(
    `  ✗ [${current}] ${kind}${payload ? ` (${payload})` : ''}: ${String(detail).slice(0, 200).replace(/\n/g, ' ')}`,
  )
}
const ok = (message) => console.log(`  ok ${message}`)

// Crashes outside the renderer's own error events.
const mainErrors = []
ramu.app.process().stderr?.on('data', (data) => {
  const text = String(data)
  if (
    /Uncaught|UnhandledPromiseRejection|TypeError:|RangeError:|FATAL ERROR|Segmentation|crashed/.test(text) &&
    !/Error occurred in handler|DevTools|Autofill/.test(text)
  )
    mainErrors.push(text)
})
let closing = false
ramu.app.on('close', () => !closing && report('app-closed', 'Electron app exited unexpectedly'))
page.on('crash', () => report('renderer-crash', 'renderer process crashed'))
page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}))
await page.setViewportSize({ width: 1280, height: 800 })

const label = (text) => text.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
const shot = (name) => ramu.shot(name).catch(() => {})
const pane = () => page.locator('.task-pane:visible')
const startComposer = () => page.locator('[data-composer-input]:visible')
const newChat = () => page.getByRole('button', { name: 'New thread in chaos work', exact: true })

/** Everything that must hold after any single hostile interaction. */
async function health(payload = '', where = '') {
  if (mainErrors.length) report('main-process-error', mainErrors.splice(0).join(' | '), payload)
  const renderer = [
    ...ramu.errors.splice(0).map((e) => `pageerror: ${e}`),
    ...ramu.consoleErrors.splice(0).map((e) => `console: ${e}`),
  ]
  for (const error of renderer) {
    // Failed IPC calls that the UI reports to the user are expected rejections, not defects.
    if (/Failed to load resource|net::ERR|DevTools|ResizeObserver loop/i.test(error)) continue
    report('renderer-error', error, payload)
  }
  const state = await page
    .evaluate(() => {
      const shell = document.querySelector('.shell')
      const root = document.getElementById('root')
      const escaped = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (!r.width || !r.height) continue
        const style = getComputedStyle(el)
        if (style.visibility === 'hidden' || style.display === 'none' || style.position === 'fixed') continue
        if (
          r.right > window.innerWidth + 2 &&
          !el.closest(
            '.xterm, .monaco-editor, [aria-hidden="true"], [data-slot="scroll-area"], .overflow-auto, .overflow-x-auto, .overflow-hidden, [style*="overflow"]',
          )
        ) {
          escaped.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} right=${Math.round(r.right)}`)
          if (escaped.length >= 3) break
        }
      }
      return {
        shell: !!shell,
        empty: !root || root.childElementCount === 0 || root.innerText.trim() === '',
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
        escaped,
        boundary: /Something went wrong|Unexpected Application Error/i.test(document.body.innerText),
      }
    })
    .catch((error) => ({ dead: String(error) }))
  if (state.dead) return report('ui-dead', `${where}: ${state.dead}`, payload)
  if (!state.shell || state.empty) report('blank-screen', `${where}: shell missing after input`, payload)
  if (state.boundary) report('error-boundary', `${where}: crash screen is showing`, payload)
  if (state.docOverflow > 1 || state.bodyOverflow > 1)
    report(
      'page-overflow',
      `${where}: page scrolls horizontally by ${Math.max(state.docOverflow, state.bodyOverflow)}px`,
      payload,
    )
  if (state.escaped?.length) report('layout-overflow', `${where}: ${state.escaped.join(', ')}`, payload)
  return state
}

const invoke = (method, ...args) =>
  page.evaluate(
    ([m, a]) =>
      window.ramu.invoke(m, ...a).then(
        (value) => ({ value }),
        (error) => ({ error: String(error?.message ?? error) }),
      ),
    [method, args],
  )

/** Types a payload into a field the way a person would (fill replaces; paste-sized input must not freeze the UI). */
async function put(locator, value) {
  await locator.click({ timeout: 5000 })
  await locator.fill(value, { timeout: 30_000 })
}

/** Runs `fn` for each payload, always checking health and keeping going after a finding. */
async function each(payloads, fn) {
  for (const [name, value] of Object.entries(payloads)) {
    const started = Date.now()
    try {
      await fn(name, value)
    } catch (error) {
      report('automation-error', error.message.split('\n')[0], name)
      await shot(`error-${current}-${label(name)}`)
    }
    const took = Date.now() - started
    if (took > 8000) report('slow', `${took}ms to handle this input`, name)
    await health(name, `after ${name}`)
  }
}

/** Registers a surface as a test that records its own failure as a finding. */
function surface(name, fn) {
  const only = process.env.RAMU_CHAOS_SURFACES?.split(',')
  test(name, { skip: name !== 'setup' && only && !only.includes(name) }, async () => {
    current = name
    console.log(`\n# ${name}`)
    try {
      await fn()
    } catch (error) {
      report('harness-failure', error.message.split('\n')[0])
      await shot(`failure-${name}`)
    }
  })
}

/** Starts a surface from Home with nothing left open by the previous one. */
async function fresh() {
  await page.keyboard.press('Escape').catch(() => {})
  await ramu.reload()
  await page
    .getByRole('button', { name: 'Home', exact: true })
    .click()
    .catch(() => {})
}

/** Puts the app on the project's file view (the explorer and editor), whatever state a previous surface left it in. */
async function openProject() {
  await page.keyboard.press('Escape').catch(() => {})
  await page.getByRole('button', { name: 'Open chaos work', exact: true }).click({ timeout: 5000 })
  await page.locator('.task-header .header-title', { hasText: 'chaos work' }).waitFor({ timeout: 8000 })
}

/** The Explorer, Search and Source Control panels share one rail; makes sure the requested one is showing. */
async function showPanel(name, probe) {
  const shortcut = { explorer: 'Shift+e', search: 'Shift+f', scm: 'Shift+g' }[name]
  if (
    !(await probe()
      .isVisible()
      .catch(() => false))
  ) {
    await page.keyboard.press(`${modifier}+${shortcut}`)
    await ramu.until(
      () =>
        probe()
          .isVisible()
          .catch(() => false),
      `the ${name} panel never showed`,
      { attempts: 10 },
    )
  }
}

/** What a person would read after an input: visible alerts, banners and toasts. */
async function messages() {
  const texts = await page
    .locator('[role="alert"], .banner, .error, [data-sonner-toast], [data-slot="toast"]')
    .allInnerTexts()
    .catch(() => [])
  return texts.map((text) => text.trim()).filter(Boolean)
}
const RAW_ERROR =
  /too_big|too_small|invalid_type|ZodError|\[\s*\{\s*"|Error invoking remote method|ENAMETOOLONG|EINVAL|SQLITE|\bundefined\b|\[object Object\]|NaN/
function checkMessages(list, payload) {
  for (const message of list)
    if (RAW_ERROR.test(message)) report('raw-error-shown', message.slice(0, 160).replace(/\n/g, ' '), payload)
}

/** Waits for the visible chat to settle; surfaces a stuck turn as a finding. */
async function settle(name, timeout = 20_000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const allow = pane().locator('.card.pending').getByRole('button', { name: 'Allow' })
    if (await allow.count())
      await allow
        .first()
        .click()
        .catch(() => {})
    if (await pane().locator('.agent-view:visible[data-state="idle"]').count()) return true
    await sleep(200)
  }
  report('stuck-turn', 'agent turn never reached idle', name)
  return false
}

surface('setup', async () => {
  // The sandbox has no real providers: make the fake agent's model the default before the UI loads it.
  const set = await invoke('settings.models.set', {
    defaultBarMode: 'model',
    sets: [
      {
        id: 'chaos',
        name: 'Chaos',
        steps: [{ id: 'fake', name: 'Fake Claude', provider: 'claude-code', model: 'fake-claude', effort: 'medium' }],
      },
    ],
    defaultSetId: 'chaos',
    defaultStepId: 'fake',
  })
  if (set.error) throw new Error(`could not configure the fake model: ${set.error}`)
  await ramu.reload()
  await page.getByRole('button', { name: 'Add project', exact: true }).click()
  // A folder with several repositories asks which ones to include.
  await page.getByRole('button', { name: 'Add 2 of 2', exact: true }).click()
  await page.locator('.repo-tree').first().waitFor({ timeout: 15_000 })
  await health('', 'add project')
  await shot('00-project')
})

surface('composer', async () => {
  await page
    .getByRole('button', { name: 'Home', exact: true })
    .click()
    .catch(() => {})
  // Typing alone first: every payload, no send.
  await newChat().click()
  await startComposer().first().waitFor()
  await each(PAYLOADS, async (name, value) => {
    await put(startComposer().first(), value)
  })
  // Then actually send: title derivation, transcript rendering, sidebar rows, header.
  await each(pick(CORE.filter((key) => key !== 'empty' && key !== 'spaces')), async (name, value) => {
    await newChat().click()
    await put(startComposer().first(), value)
    await page.keyboard.press('Enter')
    await sleep(600)
    await settle(name)
    await shot(`02-sent-${name}`)
  })
  // Whitespace-only must not send.
  for (const name of ['empty', 'spaces']) {
    await newChat().click()
    await put(startComposer().first(), PAYLOADS[name])
    await page.keyboard.press('Enter')
    await sleep(400)
    if (await pane().locator('.agent-view:visible').count())
      report('empty-send', 'a blank message started a thread', name)
  }
})

/** Calls the real IPC with a hostile argument; flags hangs, leaked internals and raw validation dumps. */
async function probe(method, args, payloadName, expect = {}) {
  const started = Date.now()
  const result = await Promise.race([invoke(method, ...args), sleep(20_000).then(() => ({ hang: true }))])
  const took = Date.now() - started
  if (result.hang) report('ipc-hang', `${method} did not answer within 20s`, payloadName)
  else if (took > 8000) report('slow', `${method} took ${took}ms`, payloadName)
  const error = result.error ?? ''
  if (/"code":|ZodError|invalid_type|too_big|too_small|\[\s*\{/.test(error))
    report('raw-validation-error', `${method}: ${error.slice(0, 160)}`, payloadName)
  if (
    /ENAMETOOLONG|ERR_INVALID_ARG|EINVAL|SQLITE|TypeError|RangeError|Cannot read|undefined is not|is not a function|at .*\.(js|ts):\d+/.test(
      error,
    )
  )
    report('leaked-internal-error', `${method}: ${error.slice(0, 200)}`, payloadName)
  if (expect.reject && !error && !result.hang)
    report(
      'accepted-bad-input',
      `${method} accepted it (${JSON.stringify(result.value ?? null).slice(0, 80)})`,
      payloadName,
    )
  return result
}

surface('ipc', async () => {
  const projects = (await invoke('projects.list')).value
  const project = projects.find((p) => p.name === 'chaos work')
  const repos = (await invoke('repos.list', project.id)).value
  const task = (await invoke('tasks.create', { projectId: project.id, title: 'chaos ipc', mode: 'current' })).value
  const webRepo = repos.find((r) => r.name === 'web app')
  const { pid } = (await invoke('background.status')).value
  const all = pick(Object.keys(PAYLOADS))

  // Names that get stored and rendered all over the UI.
  await each(all, async (n, v) => {
    const created = await probe('projects.create', [v], n)
    if (created.value?.id) {
      await probe('projects.rename', [created.value.id, v + '!'], n)
      await probe('projects.remove', [created.value.id], n)
    }
    await probe('tasks.rename', [task.id, v], n)
    await probe('agent.searchMessages', [v], n)
  })
  await invoke('tasks.rename', task.id, 'chaos ipc')

  // Memory: every field.
  await each(all, async (n, v) => {
    const saved = await probe(
      'memory.save',
      [{ kind: 'feedback', title: v, content: v, tags: [v.slice(0, 40)], importance: 3, expiresAt: null }],
      n,
    )
    if (saved.value?.id) await probe('memory.delete', [saved.value.id], n)
  })

  // Files: paths that escape, hide in .git, or break the filesystem.
  const escaping = new Set(['path', 'absolutePath', 'dotGit', 'nul'])
  await each(all, async (n, v) => {
    const bad = escaping.has(n)
    await probe('files.create', [task.id, webRepo.id, v, 'file'], n, { reject: bad && n !== 'nul' })
    await probe('files.create', [task.id, webRepo.id, `dir-${v}`, 'dir'], n)
    await probe('files.rename', [task.id, webRepo.id, 'README.md', v], n, {
      reject: n === 'path' || n === 'absolutePath' || n === 'dotGit',
    })
    await probe('files.copy', [task.id, webRepo.id, 'README.md', v], n, {
      reject: n === 'path' || n === 'absolutePath' || n === 'dotGit',
    })
    await probe('files.read', [task.id, webRepo.id, v], n)
    await probe('files.list', [task.id, webRepo.id, v], n)
    await probe('files.write', [task.id, webRepo.id, `w-${v.slice(0, 20)}.txt`, v, null], n)
  })
  const stray = ['/etc/passwd-copy', join(ramu.dir, 'etc')].filter((p) => existsSync(p))
  if (stray.length) report('path-escape', `files were created outside the repository: ${stray.join(', ')}`)
  // Editor-sized content.
  await probe('files.write', [task.id, webRepo.id, 'big.txt', 'x'.repeat(1_000_001), null], 'over1MB')
  await probe('files.write', [task.id, webRepo.id, 'big-ok.txt', 'x'.repeat(900_000), null], 'under1MB')

  // Search: regex, globs and absurd queries must produce a readable result or message.
  await each(all, async (n, v) => {
    if (!v) return
    for (const regex of [false, true])
      await probe(
        'files.search',
        [task.id, { query: v, caseSensitive: false, wholeWord: regex, regex, include: v, exclude: v }],
        n,
      )
  })

  // Git: names that look like options, refs with illegal characters.
  await each(all, async (n, v) => {
    if (!v) return
    await probe('git.createBranch', [task.id, webRepo.id, v], n, {
      reject: ['dashName', 'spaces', 'path', 'absolutePath', 'html', 'shell', 'template', 'markdown'].includes(n),
    })
    await probe('git.checkout', [task.id, webRepo.id, v], n)
    await probe('git.stash', [task.id, webRepo.id, v, false], n)
  })
  const branchNow = git(web, 'rev-parse', '--abbrev-ref', 'HEAD')
  if (branchNow !== 'main') {
    ok(`hostile branch names left HEAD on "${branchNow}" (legal in git); switching back`)
    git(web, 'switch', 'main')
  }
  writeFileSync(join(web, 'commit-me.txt'), 'x')
  await invoke('git.stage', task.id, webRepo.id, ['commit-me.txt'])
  for (const n of ['long100k', 'dashName', 'shell', 'nul', 'rtl', 'loneSurrogate', 'markdown'])
    await probe('git.commit', [task.id, webRepo.id, PAYLOADS[n]], n)

  // Schedules and project actions.
  const rule = { kind: 'daily', time: '09:00' }
  const base = {
    projectId: project.id,
    workspaceId: null,
    timezone: 'UTC',
    rule,
    missedPolicy: 'latest',
    settings: {
      provider: 'claude-code',
      model: 'fake-claude',
      effort: 'medium',
      serviceTier: 'standard',
      access: 'full',
      autoFallback: false,
    },
  }
  await each(all, async (n, v) => {
    const saved = await probe('schedules.save', [{ ...base, name: v || 'x', prompt: v || 'x' }], n)
    if (saved.value?.id) await probe('schedules.delete', [saved.value.id], n)
    await probe('projects.setActions', [project.id, [{ id: 'a1', name: v || 'x', command: v || 'x' }]], n)
  })
  const anchor = new Date().toISOString()
  for (const [name, r] of Object.entries({
    zeroMinutes: { kind: 'interval', minutes: 0, anchor },
    negativeMinutes: { kind: 'interval', minutes: -5, anchor },
    nanMinutes: { kind: 'interval', minutes: NaN, anchor },
    hugeMinutes: { kind: 'interval', minutes: Infinity, anchor },
    fractional: { kind: 'interval', minutes: 7.5, anchor },
    badTime: { kind: 'daily', time: '25:61' },
    emptyDays: { kind: 'weekly', time: '09:00', weekdays: [] },
    day31: { kind: 'monthly', time: '09:00', day: 31 },
    day0: { kind: 'monthly', time: '09:00', day: 0 },
    pastOnce: { kind: 'once', at: '2001-01-01T00:00:00Z' },
    badAnchor: { kind: 'interval', minutes: 5, anchor: 'not a date' },
    badZone: rule,
  })) {
    const timezone = name === 'badZone' ? 'Mars/Phobos' : 'UTC'
    const save = await probe('schedules.save', [{ ...base, name, prompt: 'x', rule: r, timezone }], name)
    if (save.value?.id) await invoke('schedules.delete', save.value.id)
    await probe('schedules.preview', [r, timezone], name)
  }

  // Attachments: hostile file names.
  await each(all, async (n, v) => {
    if (v) await probe('attachments.add', [v.slice(0, 255), Buffer.from('hello').toString('base64')], n)
  })

  const after = (await invoke('background.status')).value
  if (!after || after.pid !== pid)
    report('daemon-restarted', `background service pid changed ${pid} -> ${after?.pid}: it crashed during the fuzz`)
  await ramu.reload()
  await shot('03-after-ipc-fuzz')
  await health('', 'reload after ipc fuzz')
})

surface('editor', async () => {
  // Open a task so the explorer/editor are live, then drop hostile files on disk.
  await openProject()
  await showPanel('explorer', () => page.locator('.repo-tree').first())
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i} ${'lorem ipsum '.repeat(8)}`).join('\n')
  const files = {
    'big-1_5mb.txt': lines(14_000),
    'oneline-3mb.txt': 'x'.repeat(3_000_000),
    'long-line.txt': 'y'.repeat(200_000) + '\nshort\n',
    'binary.bin': Buffer.from([0, 1, 2, 3, 0, 255, 254]),
    'huge-12mb.txt': lines(110_000),
    'crlf-bom.txt': '﻿a\r\nb\r\nc\r\n',
    'zalgo-name-ṫ̸̡e̷s̵t.txt': 'name with combining marks\n',
    'emoji-👨‍👩‍👧‍👦.txt': 'emoji name\n',
    'rtl-‮gnp.txt': 'bidi override in the filename\n',
    [`${'n'.repeat(200)}.txt`]: 'very long file name\n',
    'weird name (1) [x] #%&.txt': 'punctuation in a name\n',
    'empty.txt': '',
  }
  for (const [name, content] of Object.entries(files)) writeFileSync(join(web, name), content)
  const tree = page.locator('.repo-tree', { hasText: 'web app' })
  const rowFor = (name) => tree.locator('button', { hasText: name.slice(0, 14).split(/[‪-‮]/)[0] }).first()
  await ramu.until(
    () =>
      rowFor('empty.txt')
        .isVisible()
        .catch(() => false),
    'the new files never appeared',
    {
      attempts: 100,
    },
  )
  await each(Object.fromEntries(Object.keys(files).map((n) => [n, n])), async (name) => {
    await rowFor(name).click({ timeout: 5000 })
    await sleep(1800)
    const view = pane().locator('.view:visible')
    const state = await view
      .evaluate((el) => ({
        text: el.innerText.slice(0, 200),
        editor: !!el.querySelector('.monaco-editor'),
        banner: el.querySelector('.banner')?.textContent ?? '',
      }))
      .catch(() => ({}))
    await shot(`04-editor-${label(name).slice(0, 30)}`)
    if (!state.editor && !state.text && !state.banner)
      report('file-open-blank', 'opening the file showed neither editor nor message', name)
    if (/ENAMETOOLONG|EINVAL|\[\s*\{|ZodError/.test(state.text + state.banner))
      report('leaked-internal-error', (state.text + state.banner).slice(0, 160), name)
  })
  const rtlRow = await tree
    .locator('button', { hasText: 'rtl-' })
    .first()
    .innerText()
    .catch(() => '')
  if (rtlRow && !/U\+202E/.test(rtlRow))
    report('bidi-filename-spoof', `explorer shows "${rtlRow.trim()}" for a name with a right-to-left override`, 'rtl')
  // Save a file larger than the 1,000,000 character IPC cap.
  await rowFor('big-1_5mb.txt').click({ timeout: 5000 })
  await pane()
    .locator('.view:visible .monaco-editor .view-lines')
    .first()
    .click()
    .catch(() => {})
  await page.keyboard.type('// edit\n')
  await page.keyboard.press(`${modifier}+s`)
  await sleep(1500)
  await shot('04-editor-save-large')
  const dirty = await pane()
    .locator('.view-tab.active .dirty, [role=tab][aria-selected=true] [aria-label="Unsaved changes"]')
    .count()
  const banner = await pane().locator('.banner').allInnerTexts()
  const toasts = await page
    .locator('[data-sonner-toast], [data-slot="toast"], [role="status"], [role="alert"]')
    .allInnerTexts()
    .catch(() => [])
  if (dirty && !banner.length && !toasts.some((t) => t.trim()))
    report(
      'silent-save-failure',
      'saving a >1M-character file left the tab dirty with no visible explanation',
      'big-1_5mb.txt',
    )
  if ([...banner, ...toasts].some((t) => /too_big|ZodError|\[\s*\{/.test(t)))
    report('raw-validation-error', [...banner, ...toasts].join(' | ').slice(0, 160), 'big-1_5mb.txt')
  for (const t of [...banner, ...toasts])
    if (t.trim()) ok(`save message: ${t.trim().slice(0, 120).replace(/\n/g, ' ')}`)
})

surface('dialogs', async () => {
  await openProject()
  await showPanel('explorer', () => page.locator('.repo-tree').first())
  for (const kind of ['New file', 'New folder']) {
    await page.getByRole('button', { name: kind, exact: true }).first().click()
    const input = page.getByLabel('Name', { exact: true })
    await input.waitFor({ timeout: 5000 })
    await each(
      pick([
        'empty',
        'spaces',
        'long2k',
        'long100k',
        'unbrokenPath',
        'rtl',
        'zalgo',
        'emoji',
        'nul',
        'control',
        'path',
        'absolutePath',
        'dotGit',
        'dashName',
        'html',
        'loneSurrogate',
      ]),
      async (name, value) => {
        if (!(await input.isVisible().catch(() => false))) {
          await page.getByRole('button', { name: kind, exact: true }).first().click()
          await input.waitFor({ timeout: 5000 })
        }
        await put(input, value.slice(0, 5000))
        await page.keyboard.press('Enter')
        await sleep(600)
        const list = await messages()
        checkMessages(list, `${kind}:${name}`)
        await shot(`05-dialog-${label(kind)}-${name}`)
        const stillOpen = await input.isVisible().catch(() => false)
        if (stillOpen && !list.length && value.trim())
          report('silent-rejection', `${kind} dialog stayed open with no message`, name)
        if (!stillOpen && ['path', 'absolutePath', 'dotGit'].includes(name))
          report('accepted-bad-input', `${kind} accepted "${value}"`, name)
      },
    )
    if (await input.isVisible().catch(() => false)) await page.keyboard.press('Escape')
  }
})

surface('rename', async () => {
  await openProject()
  // Header chat title, via a real chat.
  await newChat().click()
  await put(startComposer().first(), 'rename target')
  await page.keyboard.press('Enter')
  await settle('rename target')
  const title = page.locator('.task-header .header-title').first()
  await each(
    pick([
      'empty',
      'spaces',
      'long2k',
      'unbroken',
      'rtl',
      'zalgo',
      'emoji',
      'nul',
      'html',
      'loneSurrogate',
      'newlines',
    ]),
    async (name, value) => {
      await title.dblclick()
      const input = page.getByLabel('Thread title')
      await input.waitFor({ timeout: 3000 })
      await input.fill(value)
      await page.keyboard.press('Enter')
      await sleep(500)
      checkMessages(await messages(), `title:${name}`)
      await shot(`06-rename-${name}`)
      if (await input.isVisible().catch(() => false)) await page.keyboard.press('Escape')
      const shown = (await title.innerText().catch(() => '')).trim()
      if (/[‪-‮⁦-⁩]/.test(shown))
        report('bidi-title-spoof', 'a text-direction override survived in the thread title', name)
    },
  )
})

surface('schedules', async () => {
  await page.getByRole('button', { name: 'Schedules', exact: true }).click()
  await page.getByRole('button', { name: 'New schedule' }).first().click()
  const name = page.getByLabel('Name', { exact: true })
  const prompt = page.getByLabel('What should the agent do?')
  await name.waitFor({ timeout: 5000 })
  await each(pick(CORE.concat(['long100k', 'newlines', 'tabs'])), async (n, v) => {
    if (!(await name.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'New schedule' }).first().click()
      await name.waitFor({ timeout: 5000 })
    }
    await name.fill(v.slice(0, 200))
    await prompt.fill(v)
    await page
      .getByRole('button', { name: 'Save schedule' })
      .click({ timeout: 2500 })
      .catch(() => {})
    await sleep(700)
    checkMessages(await messages(), `schedule:${n}`)
    await shot(`07-schedule-${n}`)
  })
  // Number fields.
  if (!(await name.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'New schedule' }).first().click()
    await name.waitFor({ timeout: 5000 })
  }
  await name.fill('numbers')
  await prompt.fill('numbers')
  await page.getByRole('combobox', { name: 'Frequency' }).click()
  await page.getByRole('option').first().waitFor({ timeout: 5000 })
  const items = await page.getByRole('option').allInnerTexts()
  const interval = items.find((t) => /minute|interval|every/i.test(t))
  if (!interval) throw new Error(`no interval option in ${items.join(', ')}`)
  await page.getByRole('option', { name: interval }).click()
  const minutes = page.getByLabel('Every how many minutes?')
  await each(
    {
      blank: '',
      zero: '0',
      negative: '-5',
      exp: '1e309',
      four: '4',
      fraction: '7.5',
      huge: '99999999999',
      text: 'abc',
      five: '5',
    },
    async (n, v) => {
      await minutes.fill(v).catch(() => {})
      await sleep(500)
      checkMessages(await messages(), `minutes:${n}`)
      // An invalid value may leave Save disabled; that is the validation working, not a finding.
      const save = page.getByRole('button', { name: 'Save schedule' })
      if (await save.isEnabled().catch(() => false)) await save.click({ timeout: 3000 }).catch(() => {})
      await sleep(500)
      checkMessages(await messages(), `minutes-save:${n}`)
      await shot(`07-minutes-${n}`)
      if (!(await name.isVisible().catch(() => false)) && !['five'].includes(n))
        report('saved-invalid-interval', `schedule saved with minutes="${v}"`, n)
    },
  )
})

async function paste(text) {
  await page.evaluate((value) => {
    const box = document.querySelector('[data-composer-input]')
    box.focus()
    const data = new DataTransfer()
    data.setData('text/plain', value)
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, text)
}

surface('paste', async () => {
  await fresh()
  await newChat().click()
  await startComposer().first().waitFor()
  const sizes = {
    small: 'short paste ',
    kb3: 'pasted line of text\n'.repeat(150),
    mb1: 'p'.repeat(1_000_000),
    mb12: 'q'.repeat(12_000_000),
    mb30: 'r'.repeat(30_000_000),
  }
  await each(sizes, async (name, value) => {
    await paste(value)
    await sleep(1200)
    await shot(`08-paste-${name}`)
    checkMessages(await messages(), `paste:${name}`)
  })
  // Open the preview of the first attachment chip.
  const chip = page.locator('.attachment-chip').first()
  if (await chip.count()) {
    await chip.click()
    await sleep(700)
    await shot('08-paste-preview')
    await page.keyboard.press('Escape')
  } else report('paste-no-attachment', 'a 3 KB paste did not become an attachment chip', 'kb3')
})

surface('huge-composer', async () => {
  await fresh()
  await newChat().click()
  await startComposer().first().waitFor()
  await each({ chars1_2m: 'm'.repeat(1_200_000) }, async (name, value) => {
    const started = Date.now()
    await put(startComposer().first(), value)
    const typed = Date.now() - started
    if (typed > 6000) report('slow', `typing ${name} took ${typed}ms`, name)
    await page.keyboard.press('Enter')
    await sleep(1500)
    const list = await messages()
    checkMessages(list, name)
    await shot(`09-huge-${name}`)
    ok(`over-limit send message: ${list.join(' | ').slice(0, 160) || '(none)'}`)
    if (!list.length && (await pane().locator('.agent-view:visible').count()))
      report('over-limit-accepted', 'a message over the 1,000,000 character limit was accepted silently', name)
  })
})

const TEXT_SET = pick([
  'empty',
  'spaces',
  'long2k',
  'long100k',
  'unbroken',
  'rtl',
  'zalgo',
  'emoji',
  'loneSurrogate',
  'nul',
  'html',
  'regexBroken',
  'regexCatastrophic',
  'glob',
  'shell',
  'dashName',
  'path',
])

surface('search', async () => {
  await fresh()
  await openProject()
  // Chat/title search (sidebar).
  await page.getByRole('button', { name: 'Search threads', exact: true }).click()
  const chats = page.locator('input[aria-label="Search threads"]')
  await chats.waitFor({ timeout: 5000 })
  await each(TEXT_SET, async (n, v) => {
    await chats.fill(v)
    await sleep(400)
    checkMessages(await messages(), `chat-search:${n}`)
    await shot(`10-chat-search-${n}`)
  })
  await page.keyboard.press('Escape')
  // Command palette: files by name, then each prefix source (commands `>`, content `#`).
  const dialog = await palette(ramu)
  const input = dialog.locator('[data-slot=command-input]')
  for (const prefix of ['', '>', '#'])
    await each(TEXT_SET, async (n, v) => {
      await input.fill(`${prefix}${v.slice(0, 20000)}`)
      await sleep(300)
      checkMessages(await messages(), `palette${prefix}:${n}`)
    })
  await page.keyboard.press('Escape')
  // Project text search with regex toggles.
  await showPanel('search', () => page.getByLabel('Search project files', { exact: true }))
  const box = page.getByLabel('Search project files', { exact: true })
  const regexToggle = page.getByRole('button', { name: /regular expression|regex/i }).first()
  for (const useRegex of [false, true]) {
    if (useRegex && (await regexToggle.count())) await regexToggle.click()
    await each(TEXT_SET, async (n, v) => {
      await box.fill(v.slice(0, 1000))
      await page.keyboard.press('Enter')
      await sleep(900)
      const list = await messages()
      checkMessages(list, `project-search${useRegex ? '-regex' : ''}:${n}`)
      if (n === 'regexBroken' && useRegex && !list.length)
        report('silent-failure', 'an invalid regular expression produced no message', n)
    })
  }
  await shot('10-project-search')
})

surface('actions', async () => {
  await fresh()
  await openProject()
  const openAction = async () => {
    // Without saved actions the bar offers "Add action"; afterwards it moves into the Project actions menu.
    const add = page.getByRole('button', { name: 'Add action', exact: true })
    if (await add.count()) return add.first().click()
    await page.getByRole('button', { name: 'Project actions', exact: true }).click()
    await page.getByRole('menuitem', { name: /Add action/ }).click()
  }
  await openAction()
  const name = page.getByLabel('Name', { exact: true })
  const command = page.getByLabel('Command', { exact: true })
  await name.waitFor({ timeout: 5000 })
  await each(
    pick(['empty', 'spaces', 'long2k', 'unbroken', 'rtl', 'zalgo', 'emoji', 'nul', 'html', 'shell', 'long100k']),
    async (n, v) => {
      if (!(await name.isVisible().catch(() => false))) {
        await openAction()
        await name.waitFor({ timeout: 5000 })
      }
      await name.fill(v)
      await command.fill(v)
      await page
        .getByRole('button', { name: 'Save', exact: true })
        .click({ timeout: 2500 })
        .catch(() => {})
      await sleep(500)
      checkMessages(await messages(), `action:${n}`)
      await shot(`11-action-${n}`)
    },
  )
  if (await name.isVisible().catch(() => false)) await page.keyboard.press('Escape')
  await shot('11-actions-after')
})

surface('scm', async () => {
  await fresh()
  await openProject()
  await page.getByRole('button', { name: 'Source Control', exact: true }).click()
  await page.locator('.scm-repo').first().waitFor({ timeout: 8000 })
  const repoToggle = page.locator('.scm-repo-toggle', { hasText: 'web app' })
  if ((await repoToggle.getAttribute('aria-expanded')) !== 'true') await repoToggle.click()
  const message = page.getByLabel('Commit message for web app', { exact: true })
  await each(
    pick([
      'long2k',
      'long100k',
      'unbroken',
      'rtl',
      'emoji',
      'loneSurrogate',
      'nul',
      'shell',
      'dashName',
      'html',
      'markdown',
    ]),
    async (n, v) => {
      writeFileSync(join(web, `scm-chaos-${n}.txt`), `${n}\n`)
      // Row actions only appear on hover.
      await page.locator(`.change-name[title="scm-chaos-${n}.txt"]`).hover({ timeout: 10_000 })
      await page.getByRole('button', { name: `Stage scm-chaos-${n}.txt` }).click({ timeout: 10_000 })
      await message.fill(v)
      await page.keyboard.press(`${modifier}+Enter`)
      await sleep(1500)
      checkMessages(await messages(), `commit:${n}`)
      await shot(`12-commit-${n}`)
      ok(`commit(${n}) subject length ${git(web, 'log', '-1', '--format=%s').length}`)
    },
  )
  if (git(web, 'status', '--porcelain').includes('..')) report('git-state', 'unexpected status after hostile commits')
})

surface('viewport', async () => {
  for (const [w, h] of [
    [1280, 800],
    [900, 560],
    [1000, 600],
    [1920, 1080],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width: w, height: h })
    await sleep(500)
    for (const [where, open] of [
      ['project', () => openProject()],
      ['schedules', () => page.getByRole('button', { name: 'Schedules', exact: true }).click()],
      [
        'settings',
        () =>
          page
            .getByRole('button', { name: /^Settings/ })
            .first()
            .click(),
      ],
    ]) {
      try {
        await open()
        await sleep(500)
      } catch {
        continue // a screen this harness cannot reach is skipped, not a finding
      }
      await health(`${w}x${h}`, where)
      await shot(`13-${w}x${h}-${where}`)
    }
  }
})

test('no findings', async () => {
  closing = true
  if (existsSync(PWNED)) {
    report('command-injection', `${PWNED} was created by a payload`)
    rmSync(PWNED, { force: true })
  }
  writeFileSync(join(ramu.shots, 'findings.json'), JSON.stringify(findings, null, 2))
  console.log(`\n${findings.length ? `${findings.length} finding(s)` : 'No findings'}. Details: ${ramu.shots}`)
  if (findings.length) throw new Error(`${findings.length} finding(s); see the log above or findings.json`)
})
