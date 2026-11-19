import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { builtinModules, createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { build } from 'vite'
import config from '../electron.vite.config'

it('bundles ws without throwing missing optional native peer stubs in development', async () => {
  // The bundled server imports ws from its own package; the root copy may be an older ws that Expo's tools use.
  const require = createRequire(new URL('../../server/package.json', import.meta.url))
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: true,
      write: false,
      minify: false,
      rollupOptions: {
        // electron-vite leaves Node's built-ins to the runtime; without them here, a stray package named like one
        // (such as `https` in node_modules) would be bundled in its place.
        external: [...(config.main!.build!.rollupOptions!.external as string[]), ...builtinModules, /^node:/],
        input: require.resolve('ws').replace(/index\.js$/, 'wrapper.mjs'),
      },
    },
  })
  if (Array.isArray(result) || !('output' in result)) throw new Error('Expected one bundle')
  const code = result.output.map((chunk) => (chunk.type === 'chunk' ? chunk.code : '')).join('\n')
  expect(code).not.toContain('Could not resolve "bufferutil"')
  expect(code).not.toContain('Could not resolve "utf-8-validate"')
  // Loaded from a file like the app's own bundle: its CommonJS shim calls createRequire(import.meta.url).
  const dir = mkdtempSync(join(tmpdir(), 'ramu-ws-bundle-'))
  try {
    const file = join(dir, 'ws.mjs')
    writeFileSync(file, code)
    const { WebSocketServer } = await import(pathToFileURL(file).href)
    const server = new WebSocketServer({ noServer: true })
    server.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
