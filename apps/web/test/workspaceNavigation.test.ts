import { expect, it } from 'vitest'
import { AUTO_PROJECT, NO_PROJECT, type WorkspaceUiState } from '@ramu/shared/types'
import { activateWorkspaceContext, composesOnHome, projectCtx, worktreeCtx } from '../src/workspace/workspaceModel'

const state = (sidebar: WorkspaceUiState['sidebar']): WorkspaceUiState => ({
  openTaskIds: [projectCtx('project'), 'chat', worktreeCtx('isolated')],
  activeTaskId: 'chat',
  sidebar,
  collapsed: ['project:other'],
  hiddenRight: { tool: 'explorer', workspace: true },
})

it.each(['inbox', 'schedules'] as const)(
  'opens projects, chats and worktrees after visiting %s, including an already-selected chat',
  (page) => {
    for (const destination of [projectCtx('project'), 'chat', 'another-chat', worktreeCtx('isolated')]) {
      const before = state(page)
      const after = activateWorkspaceContext(before, destination)
      expect(after.activeTaskId).toBe(destination)
      expect(after.sidebar).toBe('projects')
      expect(after.openTaskIds).toBe(before.openTaskIds)
      expect(after.collapsed).toBe(before.collapsed)
      expect(after.hiddenRight).toBe(before.hiddenRight)
      expect(before.sidebar).toBe(page)
    }
  },
)

it('returns to content after consecutive Inbox and Schedules visits', () => {
  let current = state('inbox')
  current = activateWorkspaceContext(current, projectCtx('project'))
  current = { ...current, sidebar: 'schedules' }
  current = activateWorkspaceContext(current, 'chat')
  expect(current.sidebar).toBe('projects')
  expect(current.activeTaskId).toBe('chat')
})

it.each(['projects', 'explorer', 'search', 'scm'] as const)(
  'preserves the %s workspace tool when switching content',
  (sidebar) => {
    expect(activateWorkspaceContext(state(sidebar), 'another-chat').sidebar).toBe(sidebar)
  },
)

it('keeps Auto and No project drafts on Home, and opens a pane only for a real project', () => {
  expect(composesOnHome(AUTO_PROJECT)).toBe(true)
  expect(composesOnHome(NO_PROJECT)).toBe(true)
  expect(composesOnHome('project')).toBe(false)
})
