import { expect, it } from 'vitest'
import { fileIconStyle } from '../src/workspace/fileIcons'

it('picks the same icon by exact name first, then special names, then extension', () => {
  expect(fileIconStyle('apps/web/package.json')).toEqual({ icon: 'Package', tone: 'ok' })
  expect(fileIconStyle('README.md')).toEqual({ icon: 'Braces', tone: 'brand' })
  expect(fileIconStyle('docs/GUIDE.md')).toEqual({ icon: 'FileText', tone: 'muted' })
  expect(fileIconStyle('.env.local')).toEqual({ icon: 'FileKey', tone: 'warn' })
  expect(fileIconStyle('vite.config.ts')).toEqual({ icon: 'FileCog', tone: 'muted' })
  expect(fileIconStyle('src/App.tsx')).toEqual({ icon: 'FileCode', tone: 'brand' })
  expect(fileIconStyle('photo.HEIC')).toEqual({ icon: 'FileImage', tone: 'ok' })
  expect(fileIconStyle('notes')).toEqual({ icon: 'File', tone: 'muted' })
})
