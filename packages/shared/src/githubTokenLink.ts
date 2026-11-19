// GitHub's fine-grained token form, opened with Ramu's name, an expiry and the permissions Ramu uses already chosen;
// the person picks the repositories and can narrow anything before creating it.

/** Repository permissions Ramu uses: pull requests and issues, checks, Actions runs, secrets and workflow files. */
const PERMISSIONS = {
  contents: 'write',
  pull_requests: 'write',
  issues: 'write',
  checks: 'read',
  actions: 'write',
  secrets: 'write',
  workflows: 'write',
  pages: 'write',
} as const

/** The link to create a fine-grained token on GitHub (or a GitHub Enterprise server at `origin`). */
export function githubTokenLink(origin = 'github.com'): string {
  const query = new URLSearchParams({
    name: 'Ramu',
    description: 'Pull requests, checks and deploys from Ramu',
    expires_in: '90',
    ...PERMISSIONS,
  })
  return `https://${origin}/settings/personal-access-tokens/new?${query}`
}
