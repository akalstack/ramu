---
name: ramu-release
description: Prepare a Ramu desktop release, write evidence-based release notes, and optionally start the GitHub draft release workflow when requested. Use for releasing this repository or drafting its release notes.
---

Read [the release guide](../../../docs/RELEASING.md) and `package.json`. Use `scripts/release.mjs` through the package commands; do not introduce another publisher.

Determine the requested version and the previous released version tag. Inspect Git changes and relevant tests since that tag. For the first release, describe the current product from the code and documentation. Write user-facing highlights, fixes, compatibility changes and known limitations in `releases/v<version>.md`. Do not paste the commit list as final prose or claim validation that was not performed. Separate automation evidence from live provider verification. Keep unsigned/notarized status accurate.

Use `pnpm release:prepare <version>` to create the version update and a notes scaffold. If that file exists, edit it rather than rerunning prepare. Do not include unrelated uncommitted work in a release commit. Run `pnpm check` and the relevant desktop checks from the guide. Report failures and resolve release-related problems before requesting a build.

A request for notes or local preparation only ends with the reviewed local files. A request to create a GitHub draft authorizes the release commit, tag, push and draft workflow needed for that draft. Confirm the intended contents with the existing task context; ask for a missing version or release scope if it cannot be inferred. Preserve unrelated edits and do not force-push or move an existing tag.

For an authorized GitHub draft, commit the release files with the intended release changes, create and push the version tag, and run `pnpm release:draft v<version>`. Wait for the workflow, inspect failures, and verify the draft contains notes, installers and checksum files for all configured targets. Use `gh release view` and `gh run view` to report its URL and validation. Do not publish a draft unless the user explicitly requests publication. If no GitHub remote or authentication is configured, finish local preparation and report the exact setup still required.
