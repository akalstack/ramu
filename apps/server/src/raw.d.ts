// Vite inlines `?raw` imports as strings; the Swift capture helper's source is bundled this way.
declare module '*.swift?raw' {
  const source: string
  export default source
}
