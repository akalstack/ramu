# Packaging

Electron Forge builds the desktop installers. Official releases are built by `.github/workflows/release.yml` for macOS arm64 and x64 and Linux x64 and arm64, each with SHA-256 checksums. Windows is not packaged yet ([roadmap](../roadmap.md#to-build)).

## Build installers

```sh
pnpm install --frozen-lockfile
pnpm make                # installers for this machine's platform and architecture
pnpm make --arch=arm64   # or pick the architecture
```

`pnpm make` builds the app first and writes installers to `dist/make`. `pnpm package` builds the app bundle without installers (`dist/Ramu-<platform>-<arch>`).

| Platform | Output | Needs |
| --- | --- | --- |
| macOS | `.dmg`, ZIP | Xcode Command Line Tools |
| Linux | `.deb`, `.rpm`, AppImage, ZIP | `fakeroot` and `dpkg` (`.deb`), `rpm` (`.rpm`), `squashfs-tools` (AppImage) |

To build only one Linux format, pass a maker: `pnpm make --targets=@electron-forge/maker-deb`. The AppImage maker downloads the AppImage runtime for the target architecture from GitHub. Running an AppImage needs FUSE 2: `sudo apt install libfuse2t64` on Ubuntu 24.04 and later, `libfuse2` on 22.04.

`pnpm release:assets <platform> <arch>` (for example `darwin arm64` or `linux x64`) collects the installers and a checksum file into `dist/release`. Clear it between builds.

## Test a packaged build

The desktop smoke test runs against a packaged app when you point it at the executable:

```sh
RAMU_PACKAGED_EXECUTABLE="$PWD/dist/Ramu-darwin-arm64/Ramu.app/Contents/MacOS/Ramu" pnpm test:desktop-smoke
```

On Linux, `scripts/smoke/linux-deb-smoke.sh` installs the built `.deb` with `apt`, as a person would, and runs the same smoke under a virtual display (`xvfb`). CI runs it on every push. The smoke uses simulated providers, so live sign-in, start at login and real model calls still need a hands-on run.

## Sign a macOS build

Builds are unsigned unless signing variables are set. To sign and notarize your own build, export `RAMU_SIGN_IDENTITY` (a Developer ID Application identity in your keychain) and, for notarization, `APPLE_API_KEY` (path to a `.p8` App Store Connect key), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` before `pnpm make`. Check the result with `codesign --verify --deep --strict`, `spctl --assess --type execute` and `xcrun stapler validate` on `Ramu.app`. Release builds do the same in `scripts/release/macos-signing.sh`.

## Versions and updates

`pnpm release:prepare <version>` sets the version in every workspace `package.json` and writes a notes scaffold in `releases/`. The desktop app reads its own version.

The app checks `akalstack/ramu` for stable releases and skips drafts and prereleases: a tag with a hyphen (`v0.2.0-alpha.1`) is installed by hand, and a plain `vX.Y.Z` is the channel updates follow. A download needs a matching ZIP and checksum file. Installing in place needs a signed macOS app, so `APP_AUTO_UPDATE` in `packages/shared/src/updates.ts` stays `false` while releases are unsigned. Settings then links to the release for a manual install.

With it on, **Auto-update Ramu** downloads an update but doesn't restart by itself. **Restart app** leaves the service and threads running. **Restart app & service** switches to the bundled service, stops agents and recovers unfinished threads by the saved recovery setting. A healthy older service is not restarted when the app opens.

## Phone app

The phone app is built with Expo and EAS; see [its README](../../apps/mobile/README.md#development). `pnpm --filter @ramu/mobile export:ios` and `export:android` bundle the JavaScript for each platform without a native build, a quick check that the app still bundles.
