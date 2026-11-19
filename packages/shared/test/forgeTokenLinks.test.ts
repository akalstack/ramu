import { expect, it } from 'vitest'
import { azureOrganization, azureTokenLink, gitlabTokenLink, serverHost } from '../src/forgeTokenLinks'

it('opens the token page of the server the person typed, however they typed it', () => {
  expect(serverHost(' https://GitLab.Example.com/group/repo ')).toBe('gitlab.example.com')
  const link = new URL(gitlabTokenLink('gitlab.example.com:8443')!)
  expect(link.host).toBe('gitlab.example.com:8443')
  expect(link.pathname).toBe('/-/user_settings/personal_access_tokens')
  expect(link.searchParams.get('scopes')).toBe('api')
  expect(gitlabTokenLink('')).toBeNull()
  expect(gitlabTokenLink('not a server')).toBeNull()
})

it("links an Azure DevOps organization's tokens, from its name or its URL", () => {
  expect(azureTokenLink('contoso')).toBe('https://dev.azure.com/contoso/_usersSettings/tokens')
  expect(azureTokenLink('https://dev.azure.com/contoso/project')).toBe(
    'https://dev.azure.com/contoso/_usersSettings/tokens',
  )
  expect(azureOrganization(' https://dev.azure.com/contoso/project ')).toBe('contoso')
  expect(azureTokenLink('')).toBeNull()
  expect(azureTokenLink('two words')).toBeNull()
})
