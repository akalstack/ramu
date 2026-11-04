// @ts-check
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

// Static HTML for every section; only the hero's backdrop and demo hydrate as React islands.
export default defineConfig({
  site: 'https://getramu.dev',
  integrations: [react()],
  server: { port: 5180 },
  vite: {
    plugins: [tailwindcss()],
    // The workspace hoists express's cookie@0.7 to the root; bundle Astro's own cookie@2 into the prerender build so the
    // page renderer doesn't resolve the root copy from apps/site.
    environments: { prerender: { resolve: { noExternal: ['cookie'] } } },
  },
})
