import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Plain Node 24 bundle. Third-party packages stay external (they carry native binaries); @ramu/* packages are inlined.
// Chunks sit beside the entry points so the build fingerprint (see src/build.ts) covers every file.
export default defineConfig({
  build: {
    ssr: true,
    target: 'node24',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: { index: resolve(__dirname, 'src/index.ts'), cli: resolve(__dirname, 'src/cli.ts') },
      output: { format: 'es', entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' },
    },
  },
  ssr: { noExternal: [/^@ramu\//] },
})
