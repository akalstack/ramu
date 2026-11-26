import { expect, it } from 'vitest'
import { GLOBAL_PAGES } from '@ramu/shared/types'
import type { HandlerContext } from '../src/ipc/types'
import { registerUiHandlers } from '../src/ipc/handlers/ui'

const methods = registerUiHandlers({ workspace: {} } as unknown as HandlerContext)
const layout = (sidebar: string) => [{ openTaskIds: [], activeTaskId: null, sidebar }]

it('saves the layout while any page that fills the main area is open', () => {
  for (const page of ['projects', 'explorer', 'search', 'scm', ...GLOBAL_PAGES])
    expect(methods['ui.setWorkspace']!.args.safeParse(layout(page)).success).toBe(true)
  expect(methods['ui.setWorkspace']!.args.safeParse(layout('elsewhere')).success).toBe(false)
})
