import { createRequire } from 'node:module'
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
        external: config.main!.build!.rollupOptions!.external,
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
