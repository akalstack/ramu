import { expect, it } from 'vitest'
import { fileIconStyle } from '../src/workspace/fileIcons'
import { FILE_LOGO_PATHS } from '../src/workspace/fileLogos'

const logoOf = (path: string) => fileIconStyle(path).logo

it('gives languages and tools their logo in a fixed color', () => {
  expect(logoOf('src/App.ts')).toEqual({ path: FILE_LOGO_PATHS.typescript, color: '#3178C6' })
  expect(logoOf('src/App.tsx')?.path).toBe(FILE_LOGO_PATHS.react)
  expect(logoOf('main.PY')?.path).toBe(FILE_LOGO_PATHS.python)
  expect(logoOf('apps/web/package.json')?.path).toBe(FILE_LOGO_PATHS.node)
  expect(logoOf('tsconfig.base.json')?.path).toBe(FILE_LOGO_PATHS.typescript)
  expect(logoOf('vite.config.ts')?.path).toBe(FILE_LOGO_PATHS.vite)
  expect(logoOf('Dockerfile.dev')?.path).toBe(FILE_LOGO_PATHS.docker)
})

it('uses the theme tone for monochrome logos and Lucide icons for the rest', () => {
  expect(fileIconStyle('README.md')).toMatchObject({ tone: 'muted', logo: { path: FILE_LOGO_PATHS.markdown } })
  expect(logoOf('README.md')?.color).toBeUndefined()
  expect(fileIconStyle('.env.local')).toEqual({ icon: 'FileKey', tone: 'warn' })
  expect(fileIconStyle('next.config.mjs')).toEqual({ icon: 'FileCog', tone: 'muted' })
  expect(fileIconStyle('photo.HEIC')).toEqual({ icon: 'FileImage', tone: 'ok' })
  expect(fileIconStyle('notes')).toEqual({ icon: 'File', tone: 'muted' })
  // Marks that blur at icon size get a Lucide icon that reads at a glance.
  expect(fileIconStyle('deploy.sh')).toEqual({ icon: 'SquareTerminal', tone: 'ok' })
  expect(fileIconStyle('build.ps1')).toEqual({ icon: 'SquareTerminal', tone: 'ok' })
  expect(fileIconStyle('data.json')).toEqual({ icon: 'Braces', tone: 'warn' })
  expect(fileIconStyle('fix.patch')).toEqual({ icon: 'FileDiff', tone: 'brand' })
})
