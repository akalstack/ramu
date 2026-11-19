import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isThemePreviewDocument, THEME_PREVIEW_CSP, themePreviewResponse } from '../src/main/themePreview'
let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ramu-theme-origin-'))
  await mkdir(join(root, 'renderer/assets'), { recursive: true })
  await writeFile(join(root, 'renderer/theme-editor.html'), 'preview')
  await writeFile(join(root, 'renderer/index.html'), 'workspace')
  await writeFile(join(root, 'renderer/assets/editor.js'), 'editor')
  await writeFile(join(root, 'private.js'), 'must not serve')
  await mkdir(join(root, 'apps/web/src/theme'), { recursive: true })
  await mkdir(join(root, 'packages/shared/src'), { recursive: true })
  await writeFile(join(root, 'apps/web/src/theme/editorRenderer.ts'), 'source')
  await writeFile(join(root, 'packages/shared/src/theme.ts'), 'source')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
const options = () => ({
  rendererRoot: join(root, 'renderer'),
  sourceRoot: root,
  fetch: vi.fn(
    async () =>
      new Response('asset', { headers: { 'content-type': 'application/javascript', 'set-cookie': 'not forwarded' } }),
  ),
})
it('serves only the preview entry and bounded asset paths with a dedicated policy', async () => {
  const config = options()
  const response = await themePreviewResponse('ramu-theme://preview/assets/editor.js', config)
  expect(response.status).toBe(200)
  expect(config.fetch).toHaveBeenCalledWith(expect.stringContaining('/renderer/assets/editor.js'))
  expect(response.headers.get('content-security-policy')).toBe(THEME_PREVIEW_CSP)
  expect(response.headers.get('set-cookie')).toBeNull()
  expect(THEME_PREVIEW_CSP).toContain("frame-src 'none'")
  expect(THEME_PREVIEW_CSP).toContain("connect-src 'self'")
  expect(THEME_PREVIEW_CSP).not.toContain('https:')
  expect(THEME_PREVIEW_CSP).not.toContain("'unsafe-eval'")
  for (const path of [
    'index.html',
    '../private.js',
    'assets/../../private.js',
    'assets/%2e%2e/%2e%2e/private.js',
    '%00',
    'assets/editor.js%5c../private.js',
  ])
    expect((await themePreviewResponse('ramu-theme://preview/' + path, config)).status).toBe(404)
  expect((await themePreviewResponse('ramu-theme://other/assets/editor.js', config)).status).toBe(404)
})
it('refuses symlink escapes and never reads missing or non-asset files', async () => {
  const config = options()
  await symlink(join(root, 'private.js'), join(root, 'renderer/assets/escape.js'))
  expect((await themePreviewResponse('ramu-theme://preview/assets/escape.js', config)).status).toBe(404)
  expect((await themePreviewResponse('ramu-theme://preview/assets/missing.js', config)).status).toBe(404)
  expect(config.fetch).not.toHaveBeenCalled()
})
it('restricts development proxying to renderer modules and source dependencies in this checkout', async () => {
  const config = { ...options(), devUrl: 'http://localhost:5173/' }
  expect((await themePreviewResponse('ramu-theme://preview/src/theme/editorRenderer.ts?v=1', config)).status).toBe(200)
  expect(config.fetch).toHaveBeenCalledWith('http://localhost:5173/src/theme/editorRenderer.ts?v=1')
  expect(
    (await themePreviewResponse('ramu-theme://preview/@fs' + root + '/packages/shared/src/theme.ts', config)).status,
  ).toBe(200)
  config.fetch.mockClear()
  for (const path of ['/invoke', '/.env', '/@fs/etc/passwd', '/@fs/etc/private.js', '/theme-editor.html/../index.html'])
    expect((await themePreviewResponse('ramu-theme://preview' + path, config)).status).toBe(404)
  expect(config.fetch).not.toHaveBeenCalled()
  const outside = await mkdtemp(join(tmpdir(), 'ramu-preview-outside-'))
  try {
    await writeFile(join(outside, 'secret.ts'), 'private source')
    await symlink(join(outside, 'secret.ts'), join(root, 'apps/web/src/escape.ts'))
    expect((await themePreviewResponse('ramu-theme://preview/src/escape.ts', config)).status).toBe(404)
    expect((await themePreviewResponse('ramu-theme://preview/@fs' + outside + '/secret.ts', config)).status).toBe(404)
    expect(config.fetch).not.toHaveBeenCalled()
  } finally {
    await rm(outside, { recursive: true, force: true })
  }
})
it('recognizes only the fixed preview document as a permitted frame destination', () => {
  expect(isThemePreviewDocument('ramu-theme://preview/theme-editor.html#instance')).toBe(true)
  for (const url of [
    'ramu-theme://preview/assets/editor.js',
    'ramu-theme://preview/theme-editor.html?path=private',
    'https://preview/theme-editor.html',
    'ramu-theme://other/theme-editor.html',
  ])
    expect(isThemePreviewDocument(url)).toBe(false)
})
