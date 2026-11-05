# Releases

Electron Forge builds installers. GitHub Actions targets macOS arm64, macOS x64, Linux x64 and Linux arm64 (`ubuntu-24.04-arm`), adds SHA-256 checksums, and creates a draft release. Publishing is manual. Windows packaging is not in the release matrix.

## Repository setup

Enable GitHub Actions and private vulnerability reporting. Require CI on the default branch. The release workflow's final job needs repository contents write permission. Local helpers use an authenticated GitHub CLI (`gh auth login`).

`private: true` in `package.json` prevents npm publication; it does not affect desktop releases.

## Prepare

Choose a version, then review the generated notes:

```sh
pnpm release:prepare 0.1.0 --dry-run
pnpm release:prepare 0.1.0
pnpm check
pnpm test:desktop-smoke # macOS, simulated providers
```

Preparation updates the version in the root and every workspace `package.json` (the desktop app reads its own) and writes `releases/v0.1.0.md`. It does not commit, tag, push, or publish. Replace the generated scaffold with user-facing changes and installation limitations. A version-only change does not require a lockfile update.

Docs check: compare `README.md`, `docs/guide/` and `apps/mobile/README.md` against what the release actually ships (platforms, install and pairing steps, Settings names, commands that still exist). Fix drift before tagging; stale release docs cost more trust than a missing feature.

## Draft

Commit the intended release files, create a matching tag, and push it:

```sh
git commit -m "chore: prepare v0.1.0"
git tag -a v0.1.0 -m "Ramu v0.1.0"
git push origin HEAD
git push origin v0.1.0
pnpm release:draft v0.1.0 --dry-run
pnpm release:draft v0.1.0
gh run list --workflow release.yml
```

The helper requires a clean tree, matching version and notes, a local tag at HEAD, and that tag on `origin`. The workflow must exist on GitHub's default branch. Review every target's notes, installers, and checksums before publishing the draft. Prerelease tags create prerelease drafts. Never move a published tag; use a new version for corrections.

## Signing and packaged checks

CI macOS builds stay unsigned until the repository has these secrets: `MACOS_CERTIFICATE_P12` (base64 Developer ID Application `.p12`), `MACOS_CERTIFICATE_PASSWORD`, `RAMU_SIGN_IDENTITY`, and for notarization `APPLE_API_KEY_P8` (base64 `.p8`), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`. With them, `scripts/release/macos-signing.sh` imports the certificate into a temporary keychain and stages the key (Forge reads `APPLE_API_KEY` as a file path), then verifies `codesign`, Gatekeeper (`spctl`) and the stapled ticket after `pnpm make`, and finally deletes the keychain and key. Without the certificate it skips every step. Locally, export `RAMU_SIGN_IDENTITY` and the `APPLE_API_*` variables yourself.

Test signed installers on another machine. Simulated checks do not verify live provider authentication, login startup, or real model calls. Linux packaged GUI validation remains separate.

Each Linux target builds a `.deb`, an `.rpm`, an AppImage and a ZIP. The runner needs `fakeroot` and `dpkg` for the `.deb`, `rpm` (for `rpmbuild`) for the `.rpm`, and `squashfs-tools` (for `mksquashfs`) for the AppImage; the AppImage maker also downloads the AppImage runtime for the target architecture from GitHub. CI and release builds smoke test only the installed `.deb` (`scripts/smoke/linux-deb-smoke.sh`). Running the AppImage needs FUSE 2: on Ubuntu 24.04 and later install `libfuse2t64`, on Ubuntu 22.04 `libfuse2` (`sudo apt install libfuse2t64` or `sudo apt install libfuse2`).

`pnpm make` writes installers to `dist/make`. On the matching build machine, `pnpm release:assets darwin arm64` (or `darwin x64`, `linux x64`, `linux arm64`) collects installers and checksums in `dist/release`. Clear old collected artifacts before rebuilding.

For packaged macOS checks, run `RAMU_PACKAGED_EXECUTABLE=/path/to/Ramu pnpm test:desktop-smoke`.

## Updates and the background service

The app checks stable releases from `akalstack/ramu`; drafts and prereleases are excluded. Tags with a hyphen (`v0.2.0-alpha.1`) publish as prereleases and are installed manually; a plain `vX.Y.Z` tag is the stable channel that updates reach. Downloads require a matching ZIP and checksum file. Automatic installation requires a signed macOS app and compatible signed ZIP. Unsigned macOS and other platforms use manual installation.

Auto-update stays off (`APP_AUTO_UPDATE` in `packages/shared/src/updates.ts`) until builds are signed with an Apple Developer ID. The service still checks for releases, and Settings links to the GitHub release for a manual install. Once signed builds ship, set the flag to `true` to restore the **Auto-update Ramu** setting and in-app downloads.

When enabled, **Auto-update Ramu** downloads updates but does not restart automatically. **Restart app** leaves the service and threads running. **Restart app & service** switches to the bundled service, stops agents, and recovers unfinished threads according to the saved recovery setting. A healthy older service is not restarted on app launch.

The service owns macOS keep-awake behavior. First-time login startup enables it once; later choices are preserved. **Plugged in only** is the default power policy. Display and manual sleep remain available.
