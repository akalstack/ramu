import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { editorConfigFor } from '../src/main/editorconfig'

test('resolves .editorconfig per file and leaves unmatched settings unset', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ec-')))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, '.editorconfig'), 'root = true\n[*.ts]\nindent_style = space\nindent_size = 2\ninsert_final_newline = true\n[*.go]\nindent_style = tab\n')
  await writeFile(join(root, 'src', 'a.ts'), '')
  await writeFile(join(root, 'src', 'b.go'), '')
  await writeFile(join(root, 'src', 'c.py'), '')
  expect(await editorConfigFor(root, 'src/a.ts')).toEqual({ indentStyle: 'space', indentSize: 2, tabWidth: 2, insertFinalNewline: true })
  expect(await editorConfigFor(root, 'src/b.go')).toEqual({ indentStyle: 'tab', indentSize: 'tab' })
  expect(await editorConfigFor(root, 'src/c.py')).toEqual({})
})
