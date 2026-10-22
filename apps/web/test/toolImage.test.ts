import { expect, it } from 'vitest'
import { isViewImageTool, toolImageName } from '../src/views/agent/lib/toolImage'
const tool = { kind: 'tool-use' as const, toolUseId: 'image', name: 'view_image', summary: '' }
it('extracts names with extensions from provider paths and locations', () => {
  expect(toolImageName({ ...tool, input: '{"path":"/tmp/screenshots/my image.png"}' })).toBe('my image.png')
  expect(toolImageName({ ...tool, summary: 'C:\\screenshots\\photo.jpg' })).toBe('photo.jpg')
  expect(toolImageName({ ...tool, input: '{"file_path":"/work/photo.webp"}' })).toBe('photo.webp')
  expect(toolImageName({ ...tool, input: 'malformed', locations: [{ path: '/work/image.avif' }] })).toBe('image.avif')
  expect(toolImageName({ ...tool, input: 'null' })).toBeUndefined()
})
it('recognizes namespaced image viewing tools without changing image generation tools', () => {
  expect(isViewImageTool('functions.view_image')).toBe(true)
  expect(isViewImageTool('mcp__files__view_image')).toBe(true)
  expect(isViewImageTool('imagegen')).toBe(false)
})
