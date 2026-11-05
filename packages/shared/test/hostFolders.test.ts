import { expect, it } from 'vitest'
import { cloneFolderName, cloneProgressText, folderCrumbs, folderName } from '../src/workspace/hostFolders'

it('names a folder by its last part on POSIX and Windows hosts', () => {
  expect(folderName('/Users/ana/code/ramu')).toBe('ramu')
  expect(folderName('/Users/ana/code/')).toBe('code')
  expect(folderName('C:\\Users\\ana\\code')).toBe('code')
  expect(folderName('/')).toBe('/')
})

it('steps from the innermost browse root down to the folder', () => {
  expect(folderCrumbs('/Users/ana/code/ramu/apps', ['/Users/ana', '/Users/ana/code/ramu'])).toEqual([
    { name: 'ramu', path: '/Users/ana/code/ramu' },
    { name: 'apps', path: '/Users/ana/code/ramu/apps' },
  ])
  expect(folderCrumbs('/Users/ana/code', ['/Users/ana'])).toEqual([
    { name: 'ana', path: '/Users/ana' },
    { name: 'code', path: '/Users/ana/code' },
  ])
  expect(folderCrumbs('/Users/ana', ['/Users/ana/'])).toEqual([{ name: 'ana', path: '/Users/ana' }])
})

it('does not treat a sibling with a shared prefix as inside a root', () => {
  expect(folderCrumbs('/Users/anabel/x', ['/Users/ana'])).toEqual([{ name: 'x', path: '/Users/anabel/x' }])
})

it('builds Windows crumbs with backslashes', () => {
  expect(folderCrumbs('C:\\Users\\ana\\code', ['C:\\Users\\ana'])).toEqual([
    { name: 'ana', path: 'C:\\Users\\ana' },
    { name: 'code', path: 'C:\\Users\\ana\\code' },
  ])
})

it('names a clone after the repository whatever form it is given in', () => {
  expect(cloneFolderName('akalstack/ramu')).toBe('ramu')
  expect(cloneFolderName('https://github.com/akalstack/ramu.git')).toBe('ramu')
  expect(cloneFolderName('git@github.com:akalstack/ramu.git')).toBe('ramu')
  expect(cloneFolderName('https://github.com/akalstack/ramu/')).toBe('ramu')
  expect(cloneFolderName('  ')).toBe('')
})

it('describes clone progress with the phase and, once known, the percentage', () => {
  const say = (text: string) => text
  expect(cloneProgressText(null, say)).toBe('Cloning…')
  expect(cloneProgressText({ phase: 'Receiving objects', percent: null }, say)).toBe('Receiving objects')
  expect(cloneProgressText({ phase: 'Receiving objects', percent: 60 }, say)).toBe('Receiving objects 60%')
})
