import type { AccountConfig } from './auth'

/** The service's settings from its environment; the same names on any host. */
export function configFrom(env: Record<string, string | undefined>): AccountConfig & { databaseUrl: string } {
  const need = (name: string) => {
    const value = env[name]
    if (!value) throw new Error(`Set ${name}.`)
    return value
  }
  const secret = need('BETTER_AUTH_SECRET')
  if (secret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters.')
  const pair = (id: string, secretName: string) =>
    env[id] && env[secretName] ? { clientId: env[id]!, clientSecret: env[secretName]! } : undefined
  return {
    databaseUrl: need('DATABASE_URL'),
    baseURL: env.ACCOUNT_URL ?? 'https://account.akalstack.com',
    secret,
    passkeyDomain: env.PASSKEY_DOMAIN ?? 'akalstack.com',
    github: pair('GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'),
    google: pair('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
  }
}
