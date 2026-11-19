import type { ModelViewerLabels } from '@ramu/shared/interactive'
import { compileInteractive } from './compile'

const VIEWER = `import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const labels = JSON.parse(document.getElementById('ramu-model-labels').textContent)
const stage = document.getElementById('stage')
const facts = document.getElementById('facts')
const picker = document.getElementById('animation')
const bytes = Uint8Array.from(atob(document.getElementById('ramu-model').textContent.trim()), (c) => c.charCodeAt(0))

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(2, devicePixelRatio))
renderer.outputColorSpace = THREE.SRGBColorSpace
stage.appendChild(renderer.domElement)
const scene = new THREE.Scene()
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2))
const sun = new THREE.DirectionalLight(0xffffff, 2.4)
sun.position.set(3, 5, 4)
scene.add(sun)
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
const clock = new THREE.Clock()
let mixer = null

const resize = () => {
  const { width, height } = stage.getBoundingClientRect()
  renderer.setSize(width, height, false)
  camera.aspect = width / Math.max(1, height)
  camera.updateProjectionMatrix()
}
new ResizeObserver(resize).observe(stage)
resize()

new GLTFLoader().parse(bytes.buffer, '', (gltf) => {
  const model = gltf.scene
  scene.add(model)
  // Frame the model whatever its units: the camera backs off until its bounding sphere fits.
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const radius = Math.max(size.length() / 2, 0.001)
  controls.target.copy(center)
  camera.position.copy(center).add(new THREE.Vector3(1, 0.6, 1.4).normalize().multiplyScalar(radius * 2.6))
  camera.near = radius / 100
  camera.far = radius * 100
  camera.updateProjectionMatrix()
  let triangles = 0
  model.traverse((node) => {
    if (!node.isMesh) return
    const geometry = node.geometry
    triangles += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3
  })
  const number = (value) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  facts.textContent = [
    labels.triangles.replace('{0}', Math.round(triangles).toLocaleString()),
    labels.size.replace('{0}', [size.x, size.y, size.z].map(number).join(' × ')),
    (bytes.length / 1024 / 1024).toFixed(1) + ' MB',
  ].join(' · ')
  if (gltf.animations.length) {
    mixer = new THREE.AnimationMixer(model)
    const still = document.createElement('option')
    still.value = ''
    still.textContent = labels.still
    picker.append(still)
    gltf.animations.forEach((clip, index) => {
      const option = document.createElement('option')
      option.value = String(index)
      option.textContent = clip.name || labels.animation.replace('{0}', String(index + 1))
      picker.append(option)
    })
    picker.hidden = false
    picker.addEventListener('change', () => {
      mixer.stopAllAction()
      if (picker.value) mixer.clipAction(gltf.animations[Number(picker.value)]).play()
    })
  }
}, (error) => {
  facts.textContent = labels.failed + ' ' + String(error?.message ?? error)
  throw error
})

renderer.setAnimationLoop(() => {
  mixer?.update(clock.getDelta())
  controls.update()
  renderer.render(scene, camera)
})
`

const PAGE = `<style>
#stage{position:relative;height:420px;border-radius:var(--radius);background:var(--surface);overflow:hidden;touch-action:none}
#stage canvas{display:block;width:100%;height:100%}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--muted)}
.bar select{margin-left:auto}
</style>
<div id="stage"></div>
<div class="bar"><span id="facts" class="num"></span><select id="animation" hidden></select></div>
<script type="module" src="./viewer.js"></script>`

let compiled: Promise<string> | null = null

/**
 * One viewer for `.glb` and `.gltf` files on the desktop and the phone: three.js orbiting the model under neutral
 * lights, with its triangle count, size and a menu of a rigged model's animations. The model is parsed from bytes in
 * the page, so it needs no network.
 */
export async function modelViewerHtml(model: Buffer, labels: ModelViewerLabels): Promise<string> {
  compiled ??= compileInteractive([
    { path: 'index.html', content: PAGE },
    { path: 'viewer.js', content: VIEWER },
  ]).catch((error: unknown) => {
    compiled = null
    throw error
  })
  const json = JSON.stringify(labels).replace(/</g, '\\u003c')
  return `${await compiled}<script type="application/json" id="ramu-model-labels">${json}</script><script type="application/octet-stream" id="ramu-model">${model.toString('base64')}</script>`
}
