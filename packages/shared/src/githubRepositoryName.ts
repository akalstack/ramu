/** A repository GitHub accepts: a name, or `owner/name`. */
export const GITHUB_REPOSITORY_NAME = /^([A-Za-z0-9-]{1,39}\/)?[A-Za-z0-9._-]{1,100}$/

/** The GitHub name for a folder: letters, digits, dots, dashes and underscores only. */
export const githubNameFor = (folder: string) =>
  folder
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
