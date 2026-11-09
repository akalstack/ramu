import { describe, expect, it } from 'vitest'
import { codeBlockLabel, codeLanguage, dedentCode, languageName } from '../src/workspace/codeLanguage'

describe('thread code language', () => {
  it('uses explicit language aliases and file extensions before inference', () => {
    expect(codeLanguage('const a = 1', 'python')).toBe('py')
    expect(codeLanguage('', 'src/Button.tsx')).toBe('tsx')
    expect(codeLanguage('const a = 1', 'text')).toBe('txt')
    expect(codeLanguage('', 'dockerfile')).toBe('dockerfile')
  })
  it('detects common unlabeled snippets conservatively', () => {
    expect(codeLanguage('<Button className="h-8" onClick={() => commit()}>Commit</Button>')).toBe('jsx')
    expect(codeLanguage('interface Props { name: string }\n<Button />')).toBe('tsx')
    expect(codeLanguage('const count: number = 1')).toBe('ts')
    expect(codeLanguage('def hello():\n    print("hi")')).toBe('py')
    expect(codeLanguage('{"hello":"world"}')).toBe('json')
    expect(codeLanguage('git status')).toBe('sh')
    expect(codeLanguage('Here is some ordinary text.')).toBe('txt')
  })
})

describe('code block header', () => {
  it('names a file, a lone path or the language', () => {
    expect(codeBlockLabel('x', 'src/app.ts')).toEqual({ label: 'app.ts', icon: 'src/app.ts', title: 'src/app.ts' })
    expect(codeBlockLabel('skills/system/run-workflow/SKILL.md\n')).toEqual({ label: 'Path', icon: 'SKILL.md' })
    expect(codeBlockLabel('/Users/me/.gemini/antigravity-cli/builtin').label).toBe('Path')
    expect(codeBlockLabel('pnpm test', 'sh')).toEqual({ label: 'Shell', icon: 'file.sh' })
    expect(codeBlockLabel('just some words').label).toBe('Text')
    expect(languageName('zig')).toBe('ZIG')
  })

  it('drops shared indentation and blank edge lines but keeps relative indentation', () => {
    expect(dedentCode('\n    if (a) {\n      b()\n    }\n\n')).toBe('if (a) {\n  b()\n}')
    expect(dedentCode('   /Users/me/file')).toBe('/Users/me/file')
    expect(dedentCode('a\n  b')).toBe('a\n  b')
  })
})

describe('code block icons match the explorer', () => {
  it('gives a fence the same icon the explorer gives a file of that language', async () => {
    const { fileIconStyle } = await import('../src/workspace/fileIcons')
    const same = (hint: string, file: string) =>
      expect(fileIconStyle(codeBlockLabel('x y', hint).icon)).toEqual(fileIconStyle(file))
    same('sh', 'run.sh')
    same('console', 'run.sh')
    same('terminal', 'run.sh')
    same('ts', 'a.ts')
    same('python', 'a.py')
    same('dockerfile', 'Dockerfile')
    same('makefile', 'Makefile')
  })
})
