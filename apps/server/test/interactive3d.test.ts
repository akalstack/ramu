import { describe, expect, it } from 'vitest'
import { compileInteractive } from '../src/interactive/compile'
import { previewInteractive, interactiveBrowserPath } from '../src/interactive/preview'
import { forAgent } from '../src/interactive/tools'
import { interactiveSourceBytes, withoutAssetBytes, type InteractiveFile } from '@ramu/shared/interactive'

/** The smallest GLB three can draw: one triangle facing the camera. */
function triangleGlb(): Buffer {
  const positions = Buffer.alloc(36)
  ;[-1, -1, 0, 1, -1, 0, 0, 1, 0].forEach((value, index) => positions.writeFloatLE(value, index * 4))
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{ byteLength: 36 }],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] }],
    }).padEnd(Math.ceil(JSON.stringify({}).length / 4) * 4),
  )
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)])
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8)
    head.writeUInt32LE(data.length, 0)
    head.write(type, 4, 'ascii')
    return Buffer.concat([head, data])
  }
  const body = Buffer.concat([chunk('JSON', padded), chunk('BIN\0', positions)])
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + body.length, 8)
  return Buffer.concat([header, body])
}

const scene = (draw: boolean): InteractiveFile[] => [
  {
    path: 'index.html',
    content: '<div id="game" style="height:300px"></div><script type="module" src="./main.js"></script>',
  },
  {
    path: 'main.js',
    content: `import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import triangle from './models/triangle.glb'
const host = document.getElementById('game')
const renderer = new THREE.WebGLRenderer()
renderer.setSize(300, 300)
host.appendChild(renderer.domElement)
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
camera.position.z = 4
new GLTFLoader().loadAsync(triangle).then((gltf) => {
  gltf.scene.traverse((node) => { if (node.isMesh) node.material = new THREE.MeshBasicMaterial({ color: 0xff3366, side: THREE.DoubleSide }) })
  ${draw ? 'scene.add(gltf.scene)' : ''}
  renderer.setAnimationLoop(() => renderer.render(scene, camera))
})`,
  },
  { path: 'models/triangle.glb', content: triangleGlb().toString('base64'), encoding: 'base64' },
]

describe('Apps with 3D assets', () => {
  it('carries an asset once, outside the source count, and lists it without bytes for devices and agents', async () => {
    const files = scene(true)
    const html = await compileInteractive(files)
    const base64 = files[2]!.content
    expect(html.split(base64)).toHaveLength(2)
    expect(interactiveSourceBytes(files)).toBe(
      Buffer.byteLength(files[0]!.content) + Buffer.byteLength(files[1]!.content),
    )
    const document = { reference: {} as never, html, preview: '', files }
    expect(withoutAssetBytes(document).files?.[2]).toEqual({
      path: 'models/triangle.glb',
      encoding: 'base64',
      content: '',
      size: triangleGlb().length,
    })
    expect(forAgent(document).html).not.toContain(base64)
  }, 30_000)

  it.skipIf(!interactiveBrowserPath())(
    'draws a model loaded from its asset offline, and fails a 3D canvas that stays one color',
    async () => {
      const drawn = await previewInteractive(await compileInteractive(scene(true)), [])
      expect(drawn.errors).toEqual([])
      const blank = await previewInteractive(await compileInteractive(scene(false)), [])
      expect(blank.errors.join(' ')).toContain('stayed one color')
    },
    60_000,
  )
})
