import { mkdtemp, writeFile, symlink, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { readImage } from '../src/workspace/files'

it('loads local preview images while enforcing repository scope and file type', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ramu-md-images-')))
  const outside = await mkdtemp(join(tmpdir(), 'ramu-md-outside-'))
  try {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    await writeFile(join(root, 'logo.svg'), svg)
    expect(await readImage(root, 'logo.svg')).toBe(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
    await writeFile(join(outside, 'private.svg'), svg)
    await symlink(join(outside, 'private.svg'), join(root, 'escape.svg'))
    await expect(readImage(root, 'escape.svg')).rejects.toThrow('outside')
    await expect(readImage(root, '../escape.svg')).rejects.toThrow('outside')
    await expect(readImage(root, 'secret.txt')).rejects.toThrow('Unsupported')
    await writeFile(join(root, 'large.png'), Buffer.alloc(10 * 1024 * 1024 + 1))
    await expect(readImage(root, 'large.png')).rejects.toThrow('10 MB')
  } finally {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })])
  }
})
