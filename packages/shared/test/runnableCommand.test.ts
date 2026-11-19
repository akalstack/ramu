import { expect, it } from 'vitest'
import { runnableCommand } from '../src/chat/runnableCommand'

it('runs shell blocks as written and leaves other languages alone', () => {
  expect(runnableCommand('vercel login\n', 'bash')).toBe('vercel login')
  expect(runnableCommand('npm install\nnpm run dev', 'Shell')).toBe('npm install\nnpm run dev')
  expect(runnableCommand('const a = 1', 'ts')).toBeNull()
  expect(runnableCommand('vercel login', undefined)).toBeNull()
  expect(runnableCommand('   \n', 'sh')).toBeNull()
})

it('keeps only the prompted lines of a console session, not its output', () => {
  expect(runnableCommand('$ git status\nOn branch main\n$ git pull\nAlready up to date.', 'console')).toBe(
    'git status\ngit pull',
  )
  expect(runnableCommand('On branch main', 'console')).toBeNull()
})
