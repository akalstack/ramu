import { describe, expect, it } from 'vitest'
import { EMPTY_PROJECT_DRAFT, newProjectRequest, ramuMakesProject, stackName } from '../src/composer/newProjectDraft'

const draft = (change: Partial<typeof EMPTY_PROJECT_DRAFT>) => ({ ...EMPTY_PROJECT_DRAFT, ...change })

describe('new project choices', () => {
  it('lets Ramu make the project itself only for a stack it knows or no generator', () => {
    expect(ramuMakesProject(draft({ name: 'shop', stack: 'nextjs' }))).toBe(true)
    expect(ramuMakesProject(draft({ name: 'notes', stack: 'none' }))).toBe(true)
    expect(ramuMakesProject(draft({ name: 'shop', stack: '' }))).toBe(false)
    expect(ramuMakesProject(draft({ name: 'desk', stack: 'other', framework: 'Tauri' }))).toBe(false)
    expect(ramuMakesProject(draft({ stack: 'nextjs' }))).toBe(false)
  })

  it('asks the agent with the name, the framework to look up, and the folder chosen', () => {
    expect(newProjectRequest(EMPTY_PROJECT_DRAFT, 'A booking page', null)).toBe('Start a new project: A booking page')
    expect(newProjectRequest(draft({ name: 'shop' }), 'A shop', null)).toBe(
      'Start a new project named shop, with the stack you recommend: A shop',
    )
    expect(
      newProjectRequest(draft({ name: 'desk', stack: 'other', framework: ' Tauri ' }), 'A notes app', '/work'),
    ).toBe('Start a new project named desk with Tauri: A notes app\n\nPut it in /work.')
  })
})

it('shows framework names as they are, and translates only stacks named in words', () => {
  // `Go` is also the word on a Go button; the Go stack must not read as that word's translation.
  expect(stackName('go')).toBe('Go')
  expect(stackName('static')).toBe('Static site')
})
