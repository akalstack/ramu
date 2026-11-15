// Sign-in for the Ramu account: GitHub, Google or a passkey, and nothing to store or reset. Every client signs in with
// the device authorization flow (a short code confirmed in the system browser), so the desktop, a phone and
// `ramu account login` over SSH work the same way with no embedded web view, callback port or app URL scheme.
import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { bearer, deviceAuthorization } from 'better-auth/plugins'
import type { Pool } from 'pg'

export interface AccountConfig {
  /** Where the service is served, such as https://account.akalstack.com. */
  baseURL: string
  /** Signs sessions and cookies; at least 32 random characters. */
  secret: string
  github?: { clientId: string; clientSecret: string }
  google?: { clientId: string; clientSecret: string }
  /** Passkeys use the company domain, so they keep working if the service later splits across subdomains. */
  passkeyDomain: string
}

/** The device flow's clients: Ramu on a host, on a phone, and the CLI. */
export const CLIENT_IDS = ['ramu-host', 'ramu-phone', 'ramu-cli'] as const

export function createAuth(pool: Pool, config: AccountConfig) {
  return betterAuth({
    appName: 'Ramu',
    baseURL: config.baseURL,
    basePath: '/api/auth',
    secret: config.secret,
    database: pool,
    // No passwords: an account is a GitHub or Google sign-in, or a passkey added to one.
    emailAndPassword: { enabled: false },
    socialProviders: {
      ...(config.github ? { github: config.github } : {}),
      ...(config.google ? { google: config.google } : {}),
    },
    account: {
      // The identity provider's access tokens are not kept after sign-in; only the link to it is.
      storeAccountCookie: false,
      updateAccountOnSignIn: false,
      accountLinking: { enabled: true, trustedProviders: ['github', 'google'] },
    },
    session: { expiresIn: 60 * 60 * 24 * 90, updateAge: 60 * 60 * 24 },
    trustedOrigins: [config.baseURL],
    plugins: [
      bearer(),
      deviceAuthorization({
        expiresIn: '10m',
        interval: '5s',
        verificationUri: `${config.baseURL}/device`,
        validateClient: (clientId) => (CLIENT_IDS as readonly string[]).includes(clientId),
      }),
      passkey({ rpID: config.passkeyDomain, rpName: 'Ramu by Akalstack', origin: config.baseURL }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
