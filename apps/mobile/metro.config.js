// Metro config for the pnpm workspace (hoisted node_modules).
// The desktop keeps the root `react` at the workspace catalog version; React Native
// needs the exact version its renderer was built for, which lives in this app's
// own node_modules. Every `react`/`react-dom` import in the bundle resolves here so
// Metro ships a single React copy.
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
const local = path.join(__dirname, 'node_modules')
const pinned = new Set(['react', 'react-dom'])

const resolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const name = moduleName.startsWith('@') ? moduleName.split('/').slice(0, 2).join('/') : moduleName.split('/')[0]
  if (pinned.has(name)) {
    return context.resolveRequest({ ...context, originModulePath: path.join(local, 'index.js') }, moduleName, platform)
  }
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform)
}

module.exports = config
