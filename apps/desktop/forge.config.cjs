const { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

// Packaging runs from a staged copy of apps/desktop (see scripts/release/desktop-package.mjs); branding and output stay at the repository root.
const repoRoot = process.env.RAMU_REPO_ROOT || join(__dirname, '..', '..')

// Shared by the deb, rpm and AppImage makers. The npm name (@ramu/desktop) is not a package or executable name; the binary is packagerConfig.executableName.
const linuxPackage = {
  name: 'ramu',
  productName: 'Ramu',
  bin: 'Ramu',
  homepage: 'https://github.com/akalstack/ramu',
  icon: join(repoRoot, 'assets', 'icon.png'),
  categories: ['Development'],
}

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
    // The usage descriptions are what macOS shows in its Screen Recording and Accessibility prompts for computer use.
    extendInfo: {
      CFBundleName: 'Ramu',
      CFBundleDisplayName: 'Ramu',
      CFBundleIconName: 'Ramu',
      NSScreenCaptureUsageDescription:
        'Ramu shows you the screen your agent is working on and lets you step in. Nothing is recorded or kept.',
      NSAppleEventsUsageDescription: 'Ramu sends mouse and keyboard input to the computer you let an agent use.',
      NSMicrophoneUsageDescription:
        'Ramu records only while you dictate a message, and recognizes speech on this Mac. Audio is never uploaded or kept.',
      NSSpeechRecognitionUsageDescription:
        'Ramu turns your dictated message into text on this Mac. Audio never leaves your computer.',
      NSAccessibilityUsageDescription:
        'Ramu uses Accessibility to operate the apps you let an agent use and to read their on-screen text.',
    },
    icon: join(repoRoot, 'assets', 'icon'),
    // The detached Node daemon and Claude SDK executables must run outside ASAR.
    asar: false,
    ignore: [
      /^\/(src|test|docs|scripts|output|dist|releases|\.git|\.github|\.agents)(\/|$)/,
      /^\/(electron\.vite\.config\.ts|vitest\.config\.ts|forge\.config\.cjs|components\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig.*|\.npmrc|\.gitignore|\.editorconfig|\.ramu.*)$/,
      /^\/node_modules\/\.cache(\/|$)/,
    ],
    // Hardened runtime with the entitlements file, so the signed app has its own stable Screen Recording and Accessibility identity.
    ...(process.env.RAMU_SIGN_IDENTITY
      ? {
          osxSign: {
            identity: process.env.RAMU_SIGN_IDENTITY,
            optionsForFile: () => ({
              hardenedRuntime: true,
              entitlements: join(repoRoot, 'apps', 'desktop', 'build', 'entitlements.mac.plist'),
            }),
          },
        }
      : {}),
    ...(process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER
      ? {
          osxNotarize: {
            appleApiKey: process.env.APPLE_API_KEY,
            appleApiKeyId: process.env.APPLE_API_KEY_ID,
            appleApiIssuer: process.env.APPLE_API_ISSUER,
          },
        }
      : {}),
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: { overwrite: true, icon: join(repoRoot, 'assets', 'icon.icns') },
    },
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux', 'win32'] },
    {
      name: '@electron-forge/maker-deb',
      platforms: ['linux'],
      config: { options: { ...linuxPackage, maintainer: 'Ramu contributors' } },
    },
    { name: '@electron-forge/maker-rpm', platforms: ['linux'], config: { options: linuxPackage } },
    { name: '@reforged/maker-appimage', platforms: ['linux'], config: { options: linuxPackage } },
    { name: '@electron-forge/maker-squirrel', platforms: ['win32'], config: { name: 'ramu' } },
  ],
  hooks: {
    prePackage: async (_config, platform, arch) => {
      if (!existsSync(join(repoRoot, 'node_modules', '@anthropic-ai', `claude-agent-sdk-${platform}-${arch}`)))
        throw new Error(
          `Claude SDK executable for ${platform}/${arch} is missing. Install dependencies and build on the target platform.`,
        )
      if (!existsSync(join(__dirname, 'out', 'main', 'daemon.js')))
        throw new Error('Build the desktop app first: run packaging through scripts/desktop-package.mjs.')
    },
    packageAfterCopy: async (_config, buildPath, _version, platform) => {
      // Linux and Windows read the window icon from assets/ next to the app.
      mkdirSync(join(buildPath, 'assets'), { recursive: true })
      copyFileSync(join(repoRoot, 'assets', 'icon.png'), join(buildPath, 'assets', 'icon.png'))
      // buildPath is Contents/Resources/app; Assets.car (compiled from assets/Ramu.icon) must sit beside it, before signing.
      if (platform === 'darwin')
        copyFileSync(join(repoRoot, 'assets', 'Assets.car'), join(buildPath, '..', 'Assets.car'))
    },
    packageAfterPrune: async (_config, buildPath, _version, platform, arch) => {
      const root = join(buildPath, 'node_modules', 'node-pty')
      const candidates = [join(root, 'build', 'Release', 'spawn-helper')]
      const prebuilds = join(root, 'prebuilds')
      if (existsSync(prebuilds))
        for (const name of readdirSync(prebuilds)) {
          if (name !== `${platform}-${arch}`) rmSync(join(prebuilds, name), { recursive: true, force: true })
          else candidates.push(join(prebuilds, name, 'spawn-helper'))
        }
      for (const file of candidates) if (existsSync(file)) chmodSync(file, 0o755)
    },
  },
}
