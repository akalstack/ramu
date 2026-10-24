import { expect, it } from 'vitest'
import { viewerMayInvoke } from '../src/viewerAccess'

it.each([
  'background.status',
  'agent.snapshot',
  'agent.replyPermission',
  'agent.replyQuestion',
  'agent.replyElicitation',
  'agent.questionDraft',
  'agent.elicitationDraft',
  'agent.dismissQuestion',
  'settings.app.snapshot',
  'schedules.list',
  'reviews.get',
  'computer.frame',
  'computer.rtcOffer',
  'notifications.register',
])('keeps viewer read/request-answer access for %s', (method) => expect(viewerMayInvoke(method)).toBe(true))

it.each([
  'agent.submit',
  'agent.stop',
  'agent.goal.control',
  'agent.messageTask',
  'aside.ask',
  'tasks.delete',
  'projects.rename',
  'files.get',
  'git.status',
  'remote.status',
  'settings.app.patch',
  'computer.input',
  'computer.grant',
  'newMethod.get',
])('never infers viewer access for %s', (method) => expect(viewerMayInvoke(method)).toBe(false))
