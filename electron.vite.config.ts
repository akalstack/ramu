import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Electron-based terminals may export this flag; the desktop app needs GUI mode.
// Background runners set it explicitly in their own child environments.
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), daemon: resolve(__dirname, 'src/main/daemon.ts') }, output: { entryFileNames: '[name].js' } },
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
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
    plugins: [react(), tailwindcss()],
  },
})
