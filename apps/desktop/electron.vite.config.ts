import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Logger } from 'babel-plugin-react-compiler'

// Electron-based terminals may export this flag; the desktop app needs GUI mode.
// Background runners set it explicitly in their own child environments.
delete process.env.ELECTRON_RUN_AS_NODE

const web = resolve(__dirname, '../web')

// RAMU_COMPILER_LOG=1 prints every component the React Compiler skips, with the reason.
const compilerLogger: Logger | undefined = process.env.RAMU_COMPILER_LOG
  ? {
      logEvent: (file, event) => {
        if (event.kind !== 'CompileError' && event.kind !== 'CompileSkip') return
        const reason = event.kind === 'CompileSkip' ? event.reason : event.detail.reason
        console.warn(`[compiler] skip ${file?.replace(web, '')}:${event.fnLoc?.start.line ?? '?'} ${reason}`)
      },
    }
  : undefined

export default defineConfig({
  main: {
    build: {
      // The workspace server also ships inside the app (daemon.js) so a packaged install needs nothing else, and so does
      // its command line (cli.js), which Settings can put on the PATH; the two share their chunks.
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          daemon: resolve(__dirname, '../server/src/index.ts'),
          cli: resolve(__dirname, '../server/src/cli.ts'),
        },
        // Packages in this app's `dependencies` stay external and ship in node_modules; everything else is bundled. So
        // only a package that needs its own files at runtime (native addons, binaries, .wasm, or modules that artifact
        // compilation resolves) belongs there; plain JavaScript packages go in devDependencies to keep the download small.
        // Playwright ships its own runtime files; keep it as a packaged production dependency.
        // QuickJS loads its .wasm file from beside its own module, so it stays a packaged dependency too.
        // ws probes these optional native accelerators inside try/catch. Leave resolution to Node
        // so Vite's development-only missing-peer stubs cannot throw before ws can fall back.
        external: [
          'playwright-core',
          'quickjs-emscripten-core',
          '@jitl/quickjs-wasmfile-release-sync',
          'bufferutil',
          'utf-8-validate',
        ],
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
    // A second dev server on another port would share this one's dependency cache and invalidate it, which the
    // window then reports as 504 "Outdated Optimize Dep". Fail instead, so only one dev server runs per checkout.
    server: { strictPort: true },
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: { input: { index: resolve(web, 'index.html'), themeEditor: resolve(web, 'theme-editor.html') } },
    },
    plugins: [react(), babel({ presets: [reactCompilerPreset({ logger: compilerLogger })] }), tailwindcss()],
  },
})
