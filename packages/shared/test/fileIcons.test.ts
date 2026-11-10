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
  expect(fileIconStyle('docs/guide.md')).toMatchObject({ tone: 'muted', logo: { path: FILE_LOGO_PATHS.markdown } })
  expect(logoOf('docs/guide.md')?.color).toBeUndefined()
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

it('sets apart the files agents read and a project’s standard documents', () => {
  expect(logoOf('CLAUDE.md')).toEqual({ path: FILE_LOGO_PATHS.claude, color: '#D97757' })
  expect(logoOf('apps/web/CLAUDE.local.md')?.path).toBe(FILE_LOGO_PATHS.claude)
  expect(fileIconStyle('AGENTS.md')).toEqual({ icon: 'Bot', tone: 'brand' })
  expect(logoOf('GEMINI.md')?.path).toBe(FILE_LOGO_PATHS.gemini)
  expect(logoOf('.cursor/rules/style.mdc')?.path).toBe(FILE_LOGO_PATHS.cursor)
  expect(logoOf('.github/copilot-instructions.md')?.path).toBe(FILE_LOGO_PATHS.copilot)
  expect(fileIconStyle('skills/review/SKILL.md')).toEqual({ icon: 'Sparkles', tone: 'brand' })
  expect(fileIconStyle('README.md')).toEqual({ icon: 'BookOpen', tone: 'brand' })
  expect(fileIconStyle('LICENSE')).toEqual({ icon: 'Scale', tone: 'muted' })
  expect(fileIconStyle('CHANGELOG.md')).toEqual({ icon: 'History', tone: 'muted' })
  expect(fileIconStyle('SECURITY.md')).toEqual({ icon: 'ShieldCheck', tone: 'warn' })
})
