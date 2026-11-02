// Metro config for the pnpm workspace (hoisted node_modules).
// The desktop keeps the root `react` at the workspace catalog version; React Native
// needs the exact version its renderer was built for. Resolve from this app's
// dependency graph, including when both apps share a hoisted version. Every `react`/`react-dom` import in the bundle resolves here so
// Metro ships a single React copy.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS Metro config
const path = require('node:path')
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS Metro config
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
const local = path.join(__dirname, 'node_modules')
const pinned = new Set(['react', 'react-dom'])

const resolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const name = moduleName.startsWith('@') ? moduleName.split('/').slice(0, 2).join('/') : moduleName.split('/')[0]
  // @noble/hashes imports its own `crypto` entry; Metro applies the package's `browser` map and asks for
  // `./crypto.js`, which its exports do not list, so it warns on every bundle. Resolve that one file directly.
  if (moduleName === '@noble/hashes/crypto') {
    const marker = `${path.sep}@noble${path.sep}hashes${path.sep}`
    const at = context.originModulePath.lastIndexOf(marker)
    if (at >= 0) {
      const root = context.originModulePath.slice(0, at + marker.length)
      const esm = context.originModulePath.slice(at + marker.length).startsWith(`esm${path.sep}`)
      return { type: 'sourceFile', filePath: path.join(root, esm ? 'esm' : '', 'crypto.js') }
    }
  }
  if (pinned.has(name)) {
    return context.resolveRequest({ ...context, originModulePath: path.join(local, 'index.js') }, moduleName, platform)
  }
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform)
}

module.exports = config
