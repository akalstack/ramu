import { describe, expect, it } from 'vitest'
import { codeLanguage } from '../src/workspace/codeLanguage'

describe('chat code language', () => {
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
