import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '../src')
/** Where Ramu talks to agent providers. Ramu's own OAuth clients (MCP servers, plugins) live elsewhere and are not provider logins. */
const PROVIDER_CODE = ['providers', 'agent']

/**
 * A provider's login belongs to its own runtime. Reading its token file to call the provider's private services, or
 * presenting those calls as the provider's own app, is what providers suspend accounts for.
 */
const BORROWED_LOGIN = [
  /client_secret/,
  /refresh_token/,
  /oauth2\.googleapis\.com/,
  /v1internal:/,
  /DashboardService/,
  /aidev_client/,
  /x-cursor-client-type/,
]

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sources(path) : /\.ts$/.test(name) ? [path] : []
  })
}

it('reaches providers only through their own runtimes, never with a borrowed login', () => {
  const found = PROVIDER_CODE.flatMap((dir) => sources(join(SRC, dir))).flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    return BORROWED_LOGIN.filter((pattern) => pattern.test(text)).map(
      (pattern) => `${relative(SRC, file)}: ${pattern.source}`,
    )
  })
  expect(found).toEqual([])
})
