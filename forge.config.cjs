const { execFileSync } = require('node:child_process')
const { chmodSync, existsSync, readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

module.exports = {
  outDir: 'dist',
  packagerConfig: {
    name: 'Ramu',
    executableName: 'Ramu',
    appBundleId: 'app.ramu.desktop',
    appCategoryType: 'public.app-category.developer-tools',
    extendInfo: { CFBundleName: 'Ramu', CFBundleDisplayName: 'Ramu' },
    icon: 'assets/icon',
    // The detached Node daemon and Claude SDK executables must run outside ASAR.
    asar: false,
    ignore: [
      /^\/(src|test|docs|scripts|output|dist|releases|\.git|\.github|\.agents)(\/|$)/,
      /^\/(electron\.vite\.config\.ts|vitest\.config\.ts|forge\.config\.cjs|components\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig.*|\.npmrc|\.gitignore|\.editorconfig|\.ramu.*)$/,
      /^\/node_modules\/\.cache(\/|$)/,
    ],
    ...(process.env.RAMU_SIGN_IDENTITY ? { osxSign: { identity: process.env.RAMU_SIGN_IDENTITY } } : {}),
    ...(process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER ? { osxNotarize: { appleApiKey: process.env.APPLE_API_KEY, appleApiKeyId: process.env.APPLE_API_KEY_ID, appleApiIssuer: process.env.APPLE_API_ISSUER } } : {}),
  },
  rebuildConfig: {},
  makers: [
    { name: '@electron-forge/maker-dmg', platforms: ['darwin'], config: { overwrite: true, icon: 'assets/icon.icns' } },
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux', 'win32'] },
    { name: '@electron-forge/maker-deb', platforms: ['linux'], config: { options: { maintainer: 'Ramu contributors' } } },
    { name: '@electron-forge/maker-squirrel', platforms: ['win32'], config: { name: 'ramu' } },
  ],
  hooks: {
    prePackage: async (_config, platform, arch) => {
      if (!existsSync(join(__dirname, 'node_modules', '@anthropic-ai', `claude-agent-sdk-${platform}-${arch}`))) throw new Error(`Claude SDK executable for ${platform}/${arch} is missing. Install dependencies and build on the target platform.`)
      execFileSync('pnpm', ['build'], { stdio: 'inherit' })
    },
    packageAfterPrune: async (_config, buildPath, _version, platform, arch) => {
      const root = join(buildPath, 'node_modules', 'node-pty')
      const candidates = [join(root, 'build', 'Release', 'spawn-helper')]
      const prebuilds = join(root, 'prebuilds')
      if (existsSync(prebuilds)) for (const name of readdirSync(prebuilds)) {
        if (name !== `${platform}-${arch}`) rmSync(join(prebuilds, name), { recursive: true, force: true })
        else candidates.push(join(prebuilds, name, 'spawn-helper'))
      }
      for (const file of candidates) if (existsSync(file)) chmodSync(file, 0o755)
    },
  },
}
