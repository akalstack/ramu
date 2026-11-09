import { builtinModules, createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { build } from 'vite'
import config from '../electron.vite.config'

it('bundles ws without throwing missing optional native peer stubs in development', async () => {
  const require = createRequire(import.meta.url)
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
  const { WebSocketServer } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  const server = new WebSocketServer({ noServer: true })
  server.close()
})
