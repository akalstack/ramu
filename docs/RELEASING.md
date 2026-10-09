# Releasing Ramu

Releases use Electron Forge and GitHub Actions. CI checks pushes and pull requests on macOS and Linux, with the simulated Electron integration journey on macOS. The release workflow builds macOS arm64, macOS x64 and Linux x64 installers, smoke-tests the packaged macOS apps, adds SHA-256 checksums and creates a **draft** GitHub release. Publishing is manual. Windows packaging exists in Forge but is not in the release matrix: the background runtime needs Windows named-pipe support and validation first.

## One-time repository setup

Push this repository to GitHub and configure its `origin` remote. Enable GitHub Actions and private vulnerability reporting. The release workflow needs permission to write repository contents; only its final draft job receives that permission. Protect your default branch and require the CI checks before merging. Install [GitHub CLI](https://cli.github.com/) and authenticate using `gh auth login` to run the local draft helper.

No npm publishing is involved; `private: true` prevents accidental publication of the desktop package to npm. No auto-update channel is configured.

## Prepare and draft

Choose a new version explicitly; version tags have the form `v0.1.0` or `v0.1.0-beta.1`.

```sh
pnpm release:prepare 0.1.0 --dry-run
pnpm release:prepare 0.1.0
```

Preparation updates `package.json` and writes `releases/v0.1.0.md`. It does not commit, tag, push or create a GitHub release. Review the notes: replace the commit scaffold with user-facing changes, installation details and known limitations. The lockfile does not contain the root package version, so a version-only change does not require regenerating it.

```sh
pnpm check
pnpm test:e2e # macOS; simulated providers
# Stage the intended release changes, including package.json and releases/v0.1.0.md.
git commit -m "chore: prepare v0.1.0"
git tag -a v0.1.0 -m "Ramu v0.1.0"
git push origin HEAD
git push origin v0.1.0
pnpm release:draft v0.1.0 --dry-run
pnpm release:draft v0.1.0
gh run list --workflow release.yml
```

The helper requires a clean working tree, a local version tag at HEAD, notes matching `package.json`, and the same tag pushed to `origin`. It dispatches the `Draft release` workflow from that tag. The workflow file must already exist on GitHub's default branch for manual dispatch. You can also run it from the Actions page with the pushed tag as its input.

Wait for all jobs to succeed. Review the draft notes and every target's assets in GitHub Releases. The workflow checks downloaded installer checksums before uploading. Prerelease version tags create prerelease drafts. Rerunning the workflow can replace assets on an existing draft; it refuses to modify a published release. Publish from GitHub when ready. Never move a published version tag; fix a release with a new version.

## Signing and validation

The checked-in workflow builds unsigned installers and does not configure signing secrets. macOS builds are not notarized. Keep that status in the release notes. For a trusted macOS distribution, extend the workflow to import a Developer ID certificate into a temporary keychain, set `RAMU_SIGN_IDENTITY`, and provide `APPLE_API_KEY` (a temporary `.p8` file path), `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`. Forge already reads these variables. Store credentials in GitHub secrets and remove temporary files/keychains after building.

Test signed installers on a separate machine before claiming signing or notarization is working. The simulated smoke test verifies desktop behavior without provider accounts; it does not verify real model calls, provider authentication or macOS login startup in a user installation. Linux installers are built and unit-tested in CI, but do not yet receive a packaged GUI smoke test.

## Local artifacts and agent assistance

`pnpm make` writes installers to `dist/make`. Run `pnpm release:assets darwin arm64` (or `darwin x64` / `linux x64` on the matching build machine) to collect platform-named installers and checksum files in `dist/release`. It refuses duplicate output; remove the previous `dist/release` contents before collecting a rebuilt target.

The repository skill [ramu-release](../.agents/skills/ramu-release/SKILL.md) can prepare notes and a draft. Example: “Use $ramu-release to prepare version 0.1.0 and create a GitHub draft release with notes.” Asking only for notes or preparation keeps the work local.
