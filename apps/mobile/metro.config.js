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
  // lib0, which Yjs uses, imports this on React Native without installing it; it only needs random numbers.
  if (moduleName === 'isomorphic-webcrypto/src/react-native') {
    return { type: 'sourceFile', filePath: path.join(__dirname, 'src', 'runtime', 'isomorphicWebcrypto.ts') }
  }
  if (pinned.has(name)) {
    return context.resolveRequest({ ...context, originModulePath: path.join(local, 'index.js') }, moduleName, platform)
  }
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform)
}

module.exports = config
