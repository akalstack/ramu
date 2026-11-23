// Where About sends people: the repository, the site, a prefilled bug report and a version's release notes.
export const REPO = 'https://github.com/akalstack/ramu'
export const SITE = 'https://getramu.dev'

/** A bug report already naming the version and system, so the first question is answered before it is asked. */
export function bugReportUrl(version: string | null, platform: string): string {
  const environment = `Ramu ${version ?? 'unknown version'} on ${platform}`
  return `${REPO}/issues/new?${new URLSearchParams({ template: 'bug_report.yml', environment })}`
}

/** The release notes for a version, or every release before the version is known. */
export const releaseNotesUrl = (version: string | null) =>
  version ? `${REPO}/releases/tag/v${version}` : `${REPO}/releases`
