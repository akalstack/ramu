import { z } from 'zod'
import type { PluginScope } from '@ramu/shared/plugins'
import { listenForCallback } from '../../plugins/callback'
import type { PluginService } from '../../plugins/service'
import type { RegisterHandlers } from '../types'

const id = z.uuid()
const slotId = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/)
const source = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((value) => !value.startsWith('-'), 'That is not a source.')
const scope: z.ZodType<PluginScope> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('project'), projectId: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('identity'), identityId: z.string().min(1).max(200) }),
])

/** Plugins: listing is readable by paired devices; installing, credentials and removal stay on the host. */
export const registerPluginHandlers: RegisterHandlers = (ctx) => {
  const service = (): PluginService => {
    if (!ctx.plugins) throw new Error('Update this host for plugins')
    return ctx.plugins
  }
  const admin = () => {
    if (ctx.host.canAdministerIntegrations?.() !== true)
      throw new Error('Install plugins and paste their credentials on the computer running Ramu')
    return service()
  }
  const changed = () => ctx.host.send('plugins:changed', null)
  return {
    'plugins.list': { args: z.tuple([]), run: () => service().list() },
    'plugins.indexes': { args: z.tuple([]), run: () => service().indexes() },
    'plugins.browse': {
      args: z.tuple([z.string().max(200).optional()]),
      run: (query?: string) => service().browse(query),
    },
    'plugins.stage': {
      args: z.tuple([
        z.object({
          source,
          ref: z.string().max(200).optional(),
          path: z.string().max(300).optional(),
          index: z.string().max(1000).optional(),
        }),
      ]),
      run: (input: { source: string; ref?: string; path?: string; index?: string }) => admin().stage(input),
    },
    'plugins.cancel': { args: z.tuple([id]), run: (stageId: string) => service().cancel(stageId) },
    'plugins.confirm': {
      args: z.tuple([id, z.object({ scope, includeScripts: z.boolean() })]),
      run: async (stageId: string, options: { scope: PluginScope; includeScripts: boolean }) => {
        const installed = await admin().confirm(stageId, options)
        changed()
        return installed
      },
    },
    'plugins.updateReview': { args: z.tuple([id]), run: (pluginId: string) => admin().updateReview(pluginId) },
    'plugins.checkUpdates': {
      args: z.tuple([]),
      run: async () => {
        await admin().checkUpdates(true)
        changed()
        return service().list()
      },
    },
    'plugins.remove': {
      args: z.tuple([id]),
      run: async (pluginId: string) => {
        await admin().remove(pluginId)
        changed()
      },
    },
    'plugins.setEnabled': {
      args: z.tuple([id, z.boolean()]),
      run: (pluginId: string, enabled: boolean) => {
        const plugin = admin().setEnabled(pluginId, enabled)
        changed()
        return plugin
      },
    },
    'plugins.setCredential': {
      args: z.tuple([
        id,
        slotId,
        z.object({
          token: z.string().max(16_000),
          fields: z.record(z.string().max(40), z.string().max(2000)).default({}),
        }),
        z.string().min(1).max(100).optional(),
      ]),
      run: async (
        pluginId: string,
        slot: string,
        value: { token: string; fields: Record<string, string> },
        identityId?: string,
      ) => {
        if (identityId && !ctx.identities?.settings().identities.some((identity) => identity.id === identityId))
          throw new Error('That identity is not on this host.')
        const plugin = await admin().setCredential(pluginId, slot, value, identityId ?? null)
        changed()
        return plugin
      },
    },
    'plugins.removeCredential': {
      args: z.tuple([id, slotId, z.string().min(1).max(100).optional()]),
      run: async (pluginId: string, slot: string, identityId?: string) => {
        const plugin = await admin().removeCredential(pluginId, slot, identityId ?? null)
        changed()
        return plugin
      },
    },
    'plugins.signIn': {
      args: z.tuple([id, slotId, z.object({ clientId: z.string().trim().min(1).max(500), sandbox: z.boolean() })]),
      run: async (pluginId: string, slot: string, input: { clientId: string; sandbox: boolean }) => {
        const plugins = admin()
        const listener = await listenForCallback({ service: plugins.list().find((p) => p.id === pluginId)?.name })
        try {
          const started = await plugins.startSignIn(pluginId, slot, { ...input, redirectUri: listener.redirectUri })
          void listener.received
            .then(({ state, code }) => {
              if (state !== started.state) throw new Error('This sign-in was not started here.')
              return plugins.completeSignIn(state, code)
            })
            .then(changed, (error: Error) =>
              ctx.host.send('plugins:signInFailed', { pluginId, slot, message: error.message }),
            )
          return { url: started.url }
        } catch (error) {
          listener.stop()
          throw error
        }
      },
    },
    'plugins.addIndex': {
      args: z.tuple([source]),
      run: async (url: string) => {
        const indexes = await admin().addIndex(url)
        changed()
        return indexes
      },
    },
    'plugins.removeIndex': {
      args: z.tuple([z.string().min(1).max(1000)]),
      run: (url: string) => {
        const indexes = admin().removeIndex(url)
        changed()
        return indexes
      },
    },
    'plugins.dev': {
      args: z.tuple([z.string().min(1).max(1000)]),
      run: async (folder: string) => {
        const plugin = await admin().dev(folder)
        changed()
        return plugin
      },
    },
    'plugins.dataSources': { args: z.tuple([]), run: () => service().dataSources() },
  }
}
