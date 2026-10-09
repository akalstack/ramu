// Rasterizes assets/icon.svg to transparent PNGs (and the macOS .icns) using Electron's own renderer.
// Run: pnpm icons
const { app, BrowserWindow } = require('electron')
const { execFileSync } = require('node:child_process')
const { mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const svg = readFileSync(join(root, 'assets', 'icon.svg'), 'utf8')
const sizes = [16, 32, 64, 128, 256, 512, 1024]

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, transparent: true, frame: false, webPreferences: { offscreen: true } })
  const html = `<style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:1024px;height:1024px}</style>${svg}`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((resolve) => setTimeout(resolve, 300))
  const master = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  win.destroy()
  const out = new Map(sizes.map((size) => [size, size === 1024 ? master.toPNG() : master.resize({ width: size, height: size, quality: 'best' }).toPNG()]))
  writeFileSync(join(root, 'assets', 'icon.png'), out.get(1024))
  const set = join(root, 'assets', 'icon.iconset')
  rmSync(set, { recursive: true, force: true }); mkdirSync(set)
  const names = { 16: ['icon_16x16'], 32: ['icon_16x16@2x', 'icon_32x32'], 64: ['icon_32x32@2x'], 128: ['icon_128x128'], 256: ['icon_128x128@2x', 'icon_256x256'], 512: ['icon_256x256@2x', 'icon_512x512'], 1024: ['icon_512x512@2x'] }
  for (const [size, list] of Object.entries(names)) for (const name of list) writeFileSync(join(set, `${name}.png`), out.get(Number(size)))
  if (process.platform === 'darwin') execFileSync('iconutil', ['-c', 'icns', set, '-o', join(root, 'assets', 'icon.icns')])
  rmSync(set, { recursive: true, force: true })
  app.quit()
})
