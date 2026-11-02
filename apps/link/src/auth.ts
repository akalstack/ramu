import { betterAuth } from 'better-auth'
import { bearer, deviceAuthorization } from 'better-auth/plugins'

export interface Env {
  DB: D1Database
  RELAY: DurableObjectNamespace
  /** Public origin of this deployment, for OAuth redirects (`https://link.example.com`). */
  BETTER_AUTH_URL: string
  BETTER_AUTH_SECRET: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  HOST_LIMIT?: string
}

/** Ramu's own clients; the device flow refuses any other `client_id`. */
export const LINK_CLIENTS = ['ramu-host', 'ramu-desktop', 'ramu-mobile'] as const

/** Google and GitHub only: no passwords to store, reset or leak. A provider without credentials is simply not offered. */
export function providers(env: Env) {
  return {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {}),
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
      : {}),
  }
}

export function createAuth(env: Env) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    socialProviders: providers(env),
    session: { expiresIn: 60 * 60 * 24 * 90, updateAge: 60 * 60 * 24 },
    account: { accountLinking: { enabled: true, trustedProviders: ['google', 'github'] } },
    plugins: [
      bearer(),
      deviceAuthorization({
        expiresIn: '10m',
        interval: '5s',
        verificationUri: '/device',
        validateClient: (clientId) => (LINK_CLIENTS as readonly string[]).includes(clientId),
      }),
    ],
  })
}
export type Auth = ReturnType<typeof createAuth>
