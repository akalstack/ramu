import { z } from 'zod'
import type { RegisterHandlers } from '../types'

const cardId = z.uuid()

/** Tool suggestion cards in threads: read by every device, put off by full-access ones, turned on through Customize. */
export const registerToolSuggestionHandlers: RegisterHandlers = (ctx) => {
  const access = () => ({
    canTurnOn: ctx.host.canAdministerIntegrations?.() === true,
    canAnswer: ctx.host.callerIsViewer?.() !== true,
  })
  return {
    'toolSuggestions.get': {
      args: z.tuple([cardId]),
      run: (id: string) => ctx.toolSuggestions?.get(id, access()) ?? null,
    },
    'toolSuggestions.dismiss': {
      args: z.tuple([cardId]),
      run: (id: string) => {
        if (!ctx.toolSuggestions) throw new Error('Update this host for tool suggestions.')
        return ctx.toolSuggestions.dismiss(id, access())
      },
    },
  }
}
