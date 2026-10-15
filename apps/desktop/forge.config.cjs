const { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

// Packaging runs from a staged copy of apps/desktop (see scripts/desktop-package.mjs); branding and output stay at the repository root.
const repoRoot = process.env.RAMU_REPO_ROOT || join(__dirname, '..', '..')

module.exports = {
  outDir: join(repoRoot, 'dist'),
  packagerConfig: {
    name: 'Ramu',
    // Forge cannot detect the version from a staged copy that has no devDependencies.
    electronVersion: require(join(repoRoot, 'node_modules', 'electron', 'package.json')).version,
    executableName: 'Ramu',
    protocols: [{ name: 'Ramu pairing link', schemes: ['ramu'] }],
    appBundleId: 'app.ramu.desktop',
    appCategoryType: 'public.app-category.developer-tools',
    // CFBundleIconName selects the Liquid Glass icon in Assets.car (macOS 26+); older systems use icon.icns.
    extendInfo: { CFBundleName: 'Ramu', CFBundleDisplayName: 'Ramu', CFBundleIconName: 'Ramu' },
    icon: join(repoRoot, 'assets', 'icon'),
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
    { name: '@electron-forge/maker-dmg', platforms: ['darwin'], config: { overwrite: true, icon: join(repoRoot, 'assets', 'icon.icns') } },
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux', 'win32'] },
    { name: '@electron-forge/maker-deb', platforms: ['linux'], config: { options: { maintainer: 'Ramu contributors' } } },
    { name: '@electron-forge/maker-squirrel', platforms: ['win32'], config: { name: 'ramu' } },
  ],
  hooks: {
    prePackage: async (_config, platform, arch) => {
      if (!existsSync(join(repoRoot, 'node_modules', '@anthropic-ai', `claude-agent-sdk-${platform}-${arch}`))) throw new Error(`Claude SDK executable for ${platform}/${arch} is missing. Install dependencies and build on the target platform.`)
      if (!existsSync(join(__dirname, 'out', 'main', 'daemon.js'))) throw new Error('Build the desktop app first: run packaging through scripts/desktop-package.mjs.')
    },
    packageAfterCopy: async (_config, buildPath, _version, platform) => {
      // Linux and Windows read the window icon from assets/ next to the app.
      mkdirSync(join(buildPath, 'assets'), { recursive: true })
      copyFileSync(join(repoRoot, 'assets', 'icon.png'), join(buildPath, 'assets', 'icon.png'))
      // buildPath is Contents/Resources/app; Assets.car (compiled from assets/Ramu.icon) must sit beside it, before signing.
      if (platform === 'darwin') copyFileSync(join(repoRoot, 'assets', 'Assets.car'), join(buildPath, '..', 'Assets.car'))
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
