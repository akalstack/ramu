import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Electron-based terminals may export this flag; the desktop app needs GUI mode.
// Background runners set it explicitly in their own child environments.
delete process.env.ELECTRON_RUN_AS_NODE

const web = resolve(__dirname, '../web')

// RAMU_COMPILER_LOG=1 prints every component the React Compiler skips, with the reason.
const compilerLogger = process.env.RAMU_COMPILER_LOG
  ? {
      logEvent: (
        file: string | null,
        event: { kind: string; fnLoc?: { start: { line: number } }; detail?: { reason?: string } },
      ) => {
        if (event.kind === 'CompileError' || event.kind === 'CompileSkip')
          console.warn(
            `[compiler] skip ${file?.replace(web, '')}:${event.fnLoc?.start.line ?? '?'} ${event.detail?.reason ?? ''}`,
          )
      },
    }
  : undefined

export default defineConfig({
  main: {
    build: {
      // The workspace server also ships inside the app (daemon.js) so a packaged install needs nothing else.
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts'), daemon: resolve(__dirname, '../server/src/index.ts') },
        // Playwright ships its own runtime files; keep it as a packaged production dependency.
        external: ['playwright-core'],
        output: { entryFileNames: '[name].js' },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
        // Sandboxed preload scripts cannot be ES modules.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    resolve: { alias: { '@': resolve(web, 'src') } },
    root: web,
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: { input: resolve(web, 'index.html') },
    },
    plugins: [
      react({ babel: { plugins: [['babel-plugin-react-compiler', { logger: compilerLogger }]] } }),
      tailwindcss(),
    ],
  },
})
