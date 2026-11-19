import { describe, expect, it } from 'vitest'
import { modelViewerHtml } from '../src/interactive/modelViewer'

const labels = {
  triangles: '{0} triangles',
  size: 'Size {0}',
  animation: 'Animation {0}',
  still: 'Still',
  failed: '</script>',
}

describe('3D model viewer', () => {
  it('bundles three offline with the model and labels as inert data', async () => {
    const model = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(8)])
    const html = await modelViewerHtml(model, labels)
    expect(html).not.toMatch(/<script[^>]+src=/)
    expect(html).toContain(
      `<script type="application/octet-stream" id="ramu-model">${model.toString('base64')}</script>`,
    )
    // A label cannot close the data block it sits in.
    expect(html).toContain('\\u003c/script>')
    expect(html).toContain('WebGLRenderer')
    expect(Buffer.byteLength(html)).toBeLessThan(1_500_000)
  }, 30_000)
})
