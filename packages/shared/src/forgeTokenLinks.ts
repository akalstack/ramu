// Pages where a person creates the token a hosting service needs, opened with as much already filled in as the
// service allows, so connecting takes one trip to the browser.

/** Atlassian API tokens are made on the account page; Bitbucket scopes are chosen there. */
export const BITBUCKET_TOKEN_LINK = 'https://id.atlassian.com/manage-profile/security/api-tokens'

/** `gitlab.com`, `https://gitlab.example.com/` or `gitlab.example.com:8443` as the bare host the server stores. */
export function serverHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
}

/** GitLab's new-token form with Ramu's name and the api scope chosen, on gitlab.com or a self-managed server. */
export function gitlabTokenLink(server: string): string | null {
  const host = serverHost(server)
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/.test(host)) return null
  return `https://${host}/-/user_settings/personal_access_tokens?${new URLSearchParams({ name: 'Ramu', scopes: 'api' })}`
}

/** The organization name from `contoso` or a pasted `https://dev.azure.com/contoso/project` URL. */
export function azureOrganization(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/dev\.azure\.com\//i, '')
    .replace(/\/.*$/, '')
}

/** An Azure DevOps organization's personal access token page; organizations are single path segments. */
export function azureTokenLink(organization: string): string | null {
  const name = azureOrganization(organization)
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/.test(name)
    ? `https://dev.azure.com/${encodeURIComponent(name)}/_usersSettings/tokens`
    : null
}
