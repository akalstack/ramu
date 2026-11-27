import { z } from 'zod'
import { ADMINISTER_REFUSAL } from '@ramu/shared/devicePermissions'
import { ACCOUNT_TRUST, type AccountTrust } from '@ramu/shared/account'
import type { AccountService } from '../../account/service'
import type { RegisterHandlers } from '../types'

const id = z.uuid()
const source = z.enum(['account', 'github'])
const trust = z.enum(ACCOUNT_TRUST as [AccountTrust, ...AccountTrust[]])

/** The Ramu account on this host. Signing in and backup changes stay on the host, like other credentials. */
export const registerAccountHandlers: RegisterHandlers = (ctx) => {
  const service = (): AccountService => {
    if (!ctx.account) throw new Error('Update this host for the Ramu account')
    return ctx.account
  }
  const admin = () => {
    if (ctx.host.canAdministerIntegrations?.() !== true) throw new Error(ADMINISTER_REFUSAL)
    return service()
  }
  return {
    'account.status': { args: z.tuple([]), run: () => service().status() },
    'account.signIn': { args: z.tuple([]), run: () => admin().signIn() },
    'account.cancelSignIn': { args: z.tuple([]), run: () => admin().cancelSignIn() },
    'account.signOut': { args: z.tuple([]), run: () => admin().signOut() },
    'account.delete': { args: z.tuple([]), run: () => admin().deleteAccount() },
    'account.setBackup': {
      args: z.tuple([z.object({ account: z.boolean().optional(), github: z.boolean().optional() })]),
      run: (destinations: { account?: boolean; github?: boolean }) => admin().setBackup(destinations),
    },
    'account.backupNow': { args: z.tuple([]), run: () => admin().backupNow() },
    'account.newRecoveryCode': { args: z.tuple([]), run: () => admin().newRecoveryCode() },
    'account.deleteBackups': {
      args: z.tuple([source]),
      run: (where: 'account' | 'github') => admin().deleteBackups(where),
    },
    'account.restoreChoices': { args: z.tuple([]), run: () => admin().restoreChoices() },
    'account.restoreFile': {
      args: z.tuple([z.object({ source, slot: z.string().regex(/^[0-9a-f]{32}$/), version: z.string().max(40) })]),
      run: (choice: { source: 'account' | 'github'; slot: string; version: string }) => admin().restoreFile(choice),
    },
    'account.useRecoveryCode': {
      args: z.tuple([z.string().min(20).max(80), source]),
      run: (code: string, where: 'account' | 'github') => admin().useRecoveryCode(code, where),
    },
    'account.requestKey': { args: z.tuple([]), run: () => admin().requestKey() },
    'account.keyRequestState': { args: z.tuple([]), run: () => service().keyRequestState() },
    'account.keyRequests': { args: z.tuple([]), run: () => service().keyRequests() },
    'account.answerKeyRequest': { args: z.tuple([id]), run: (request: string) => admin().answerKeyRequest(request) },
    'account.approveKeyRequest': { args: z.tuple([id]), run: (request: string) => admin().approveKeyRequest(request) },
    'account.denyKeyRequest': { args: z.tuple([id]), run: (request: string) => admin().denyKeyRequest(request) },
    // Whether this host's own account may pair devices without asking is a host decision, like pairing itself.
    'account.setListed': {
      args: z.union([z.tuple([z.boolean()]), z.tuple([z.boolean(), trust])]),
      run: (listed: boolean, chosen?: AccountTrust) => admin().setListed(listed, chosen),
    },
    'account.setTrust': { args: z.tuple([trust]), run: (chosen: AccountTrust) => admin().setTrust(chosen) },
    'account.hosts': { args: z.tuple([]), run: () => service().hosts() },
    'account.relay': {
      args: z.tuple([id, z.enum(['/pair/request', '/pair/reveal', '/pair/wait']), z.unknown()]),
      run: (host: string, path: string, body: unknown) => admin().relay(host, path, body),
    },
  }
}
