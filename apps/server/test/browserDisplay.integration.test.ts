import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it } from 'vitest'
import { HostBrowser } from '../src/browser/hostBrowser'

const executable = process.env.RAMU_BROWSER_EXECUTABLE || chromium.executablePath()
it.skipIf(!existsSync(executable))(
  'lays a real page out for the phone, zooms it, changes its appearance and reports the focused field',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'ramu-display-browser-'))
    let loads = 0
    const server = createServer((_request, response) => {
      loads++
      response.setHeader('Content-Type', 'text/html')
      response.setHeader('Cache-Control', 'max-age=3600')
      response.end(`<body style="margin:0">
      <input id="mail" type="email" style="position:absolute;left:0;top:0;width:200px;height:40px">
      <p id="out"></p>
      <script>
        const show = () => (out.textContent =
          'width ' + innerWidth + ' dark ' + matchMedia('(prefers-color-scheme: dark)').matches)
        addEventListener('resize', show)
        matchMedia('(prefers-color-scheme: dark)').addEventListener('change', show)
        show()
      </script></body>`)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const browser = new HostBrowser(root, () => {})
    // The page reports its layout from resize and media events, which land a moment after the change.
    const text = async (id: string) => {
      let last = ''
      for (let attempt = 0; attempt < 50; attempt++) {
        last = (await browser.read('local', 'thread', id)).text
        if (!expected || last.includes(expected)) return last
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return last
    }
    let expected = ''
    const shows = async (id: string, value: string) => {
      expected = value
      expect(await text(id)).toContain(value)
    }
    try {
      await browser.prepare()
      const port = (server.address() as { port: number }).port
      const { tab } = await browser.open('local', 'thread', `http://127.0.0.1:${port}`)
      await shows(tab.id, 'width 1024')

      // Phone layout, then zoom: the page lays out in fewer CSS pixels and comes back at 100%.
      expect(await browser.fit('local', 'thread', tab.id, { width: 390, height: 640 })).toEqual({ fitted: true })
      await shows(tab.id, 'width 390')
      const zoomed = await browser.adjust('local', 'thread', tab.id, { zoom: 2 })
      expect(zoomed.zoom).toBe(2)
      await shows(tab.id, 'width 195')

      // A tap on the left of the zoomed frame still lands on the field there, and the phone learns its kind.
      await browser.input('local', 'thread', tab.id, tab.generation, {
        kind: 'click',
        x: 0.2,
        y: 0.02,
        button: 'left',
        clickCount: 1,
      })
      expect(await browser.focus('local', 'thread', tab.id)).toEqual({ editable: true, kind: 'email' })
      await browser.adjust('local', 'thread', tab.id, { zoom: 1 })
      await shows(tab.id, 'width 390')

      expect((await browser.adjust('local', 'thread', tab.id, { colorScheme: 'dark' })).colorScheme).toBe('dark')
      await shows(tab.id, 'dark true')
      expect((await browser.adjust('local', 'thread', tab.id, { colorScheme: 'system' })).colorScheme).toBeUndefined()

      // A hard reload asks the server again even though the page is cacheable.
      const before = loads
      await browser.adjust('local', 'thread', tab.id, { hardReload: true })
      expect(loads).toBeGreaterThan(before)
      await browser.adjust('local', 'thread', tab.id, { clearCache: true })
      await shows(tab.id, 'width 390')
    } finally {
      await browser.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
  60_000,
)
