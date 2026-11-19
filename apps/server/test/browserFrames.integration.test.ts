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
  'views and controls the same real host tab through live compositor frames',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'ramu-live-browser-'))
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html')
      response.end(`<button onclick="this.textContent='Clicked'">Click me</button>
      <div style="height:2000px;background:linear-gradient(coral,navy)"></div>
      <script>let n=0;setInterval(()=>document.body.style.paddingLeft=(++n%20)+'px',40)</script>`)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const browser = new HostBrowser(root, () => {})
    try {
      await browser.prepare()
      const port = (server.address() as { port: number }).port
      const { tab } = await browser.open('local', 'thread', `http://127.0.0.1:${port}`)
      let sequence = 0
      const started = Date.now()
      let received = 0
      while (received < 10) {
        const frame = await browser.nextFrame('local', 'thread', tab.id, sequence)
        if (!frame) continue
        expect(frame.sequence).toBeGreaterThan(sequence)
        expect(frame.width).toBe(1024)
        expect(Buffer.from(frame.data, 'base64').subarray(0, 2).toString('hex')).toBe('ffd8')
        sequence = frame.sequence
        received++
      }
      console.info(`Live browser: ${received} changed frames in ${Date.now() - started} ms`)
      await browser.input('local', 'thread', tab.id, tab.generation, {
        kind: 'click',
        x: 0.04,
        y: 0.02,
        button: 'left',
        clickCount: 1,
      })
      expect((await browser.read('local', 'thread', tab.id)).text).toContain('Clicked')
      await browser.input('local', 'thread', tab.id, tab.generation, { kind: 'scroll', x: 0, y: 400 })
      expect(await browser.nextFrame('local', 'thread', tab.id, sequence)).not.toBeNull()
      await expect(browser.nextFrame('local', 'different-thread', tab.id, 0)).rejects.toThrow()
      browser.closeTab('local', 'thread', tab.id)
      await expect(browser.nextFrame('local', 'thread', tab.id, 0)).rejects.toThrow()
    } finally {
      await browser.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
