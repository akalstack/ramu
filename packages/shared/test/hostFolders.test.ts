import { describe, expect, it } from 'vitest'
import {
  cloneFolderName,
  cloneStartFolder,
  cloneProgressText,
  folderCrumbs,
  folderName,
  isProjectFolder,
  isSystemFolder,
  placeLabel,
  titleFolderName,
  typedFolderPath,
} from '../src/workspace/hostFolders'

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

it('names a folder after a title, and accepts only plain project-relative folders', () => {
  expect(titleFolderName('Pricing — Q3 plan!')).toBe('pricing-q3-plan')
  expect(titleFolderName('日本語')).toBe('artifact')
  expect(titleFolderName(`${'a'.repeat(59)} b`)).toBe('a'.repeat(59))
  expect(isProjectFolder('src/pricing')).toBe(true)
  expect(isProjectFolder('../outside')).toBe(false)
  expect(isProjectFolder('/etc')).toBe(false)
  expect(isProjectFolder('src/.hidden')).toBe(false)
  expect(isProjectFolder('src//x')).toBe(false)
})

describe('cloneStartFolder', () => {
  it('picks the folder most projects sit side by side in, when it can be browsed', () => {
    expect(
      cloneStartFolder(['/Users/me', '/Users/me/Projects/acme/app', '/Users/me/Projects/acme/api', '/Users/me/x/y']),
    ).toBe('/Users/me/Projects/acme')
  })
  it('leaves a folder outside every root alone', () => {
    expect(cloneStartFolder(['/Users/me', '/Volumes/Drive/work/app'])).toBeUndefined()
    expect(cloneStartFolder(['/Users/me'])).toBeUndefined()
  })
  it('reads Windows paths', () => {
    expect(cloneStartFolder(['C:\\Users\\me', 'C:\\Users\\me\\code\\app'])).toBe('C:\\Users\\me\\code')
  })
})

describe('folder picker places', () => {
  const say = (text: string) => `[${text}]`
  it('names home by its role, the root by its boot volume when it has one, and drives by their own name', () => {
    expect(placeLabel({ kind: 'home', name: 'ana', path: '/Users/ana' }, say)).toBe('[Home folder]')
    expect(placeLabel({ kind: 'computer', name: '/', path: '/' }, say)).toBe('[Computer]')
    expect(placeLabel({ kind: 'computer', name: 'Macintosh HD', path: '/' }, say)).toBe('Macintosh HD')
    expect(placeLabel({ kind: 'drive', name: 'Drive', path: '/Volumes/Drive' }, say)).toBe('Drive')
  })
  it('takes a typed or pasted path without the spaces and quotes around it', () => {
    expect(typedFolderPath('  /Volumes/My Drive/ ')).toBe('/Volumes/My Drive/')
    expect(typedFolderPath('"/Volumes/My Drive"')).toBe('/Volumes/My Drive')
    expect(typedFolderPath("'~/code'")).toBe('~/code')
    expect(typedFolderPath('  ')).toBe('')
  })
})

describe('isSystemFolder', () => {
  it('refuses filesystem and drive roots on every platform', () => {
    expect(isSystemFolder('/', 'darwin')).toBe(true)
    expect(isSystemFolder('/', 'linux')).toBe(true)
    expect(isSystemFolder('C:\\', 'win32')).toBe(true)
    expect(isSystemFolder('D:', 'win32')).toBe(true)
  })
  it('refuses operating-system folders but not the folders inside them', () => {
    expect(isSystemFolder('/usr/', 'linux')).toBe(true)
    expect(isSystemFolder('/media', 'linux')).toBe(true)
    expect(isSystemFolder('/usr/local/src/app', 'linux')).toBe(false)
    expect(isSystemFolder('/system', 'darwin')).toBe(true)
    expect(isSystemFolder('/Volumes', 'darwin')).toBe(true)
    expect(isSystemFolder('/Volumes/Drive', 'darwin')).toBe(false)
    expect(isSystemFolder('c:\\windows', 'win32')).toBe(true)
    expect(isSystemFolder('C:\\Users\\ana\\code', 'win32')).toBe(false)
  })
  it('compares case on Linux, where /System is just a folder', () => {
    expect(isSystemFolder('/System', 'linux')).toBe(false)
  })
})
