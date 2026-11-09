import { describe, expect, it } from 'vitest'
import { HOST_ONLY_SECTIONS, SETTINGS_MENU, SETTINGS_MENU_GROUPS } from '../src/settingsMenu'

const pages = (group: string) => SETTINGS_MENU.filter((entry) => entry.group === group).map((entry) => entry.id)

describe('settings menu', () => {
  it('has four groups of four to six pages, named for what the person is doing', () => {
    expect(SETTINGS_MENU_GROUPS).toEqual(['Personal', 'Agents', 'Agent tools', 'Access & host'])
    for (const group of SETTINGS_MENU_GROUPS) {
      expect(pages(group).length).toBeGreaterThanOrEqual(4)
      expect(pages(group).length).toBeLessThanOrEqual(6)
    }
    expect(pages('Personal')).toEqual(['appearance', 'chats', 'editor', 'shortcuts'])
    expect(pages('Agents')).toEqual(['providers', 'models', 'agent-setup', 'plugins', 'workflows', 'memory'])
    expect(pages('Agent tools')).toEqual(['browser', 'computer', 'devices', 'git', 'deploy'])
    expect(pages('Access & host')).toEqual(['access', 'identities', 'remote', 'account', 'system'])
  })

  it('gives test devices a page of their own and keeps lists and merged pages out of the menu', () => {
    const ids: string[] = SETTINGS_MENU.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(SETTINGS_MENU.find((entry) => entry.id === 'devices')?.label).toBe('Test devices')
    expect(SETTINGS_MENU.find((entry) => entry.id === 'computer')?.label).toBe('Computer')
    for (const gone of ['archived', 'environment']) expect(ids).not.toContain(gone)
  })

  it('leaves only the host keyboard and screen pages to the host', () => {
    expect(HOST_ONLY_SECTIONS).toEqual(['Editor & Terminal', 'Keyboard shortcuts'])
  })
})
