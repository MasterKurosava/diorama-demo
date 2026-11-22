import { effect } from '@dioramajs/diorama'
import {
  cameraPosition,
  equirectUV,
  float,
  mix,
  normalize,
  normalLocal,
  normalWorld,
  positionLocal,
  positionWorld,
  reflect,
  sin,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl'
import type { Node } from 'three/webgpu'
import {
  CanvasTexture,
  IcosahedronGeometry,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  SRGBColorSpace,
} from 'three/webgpu'
import { DEPTH, hero, inScene, nearFade, touchable } from './_hero'
import { WARM } from './_look'

/** Equirect sunset for the drop to reflect. */
function sunset(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const g = canvas.getContext('2d') as CanvasRenderingContext2D
  const sky = g.createLinearGradient(0, 0, 0, 512)
  sky.addColorStop(0, '#3a0f12')
  sky.addColorStop(0.42, '#a8584a')
  sky.addColorStop(0.5, '#f4b98c')
  sky.addColorStop(0.56, '#9a4b45')
  sky.addColorStop(1, '#2a0a0c')
  g.fillStyle = sky
  g.fillRect(0, 0, 1024, 512)
  const sun = g.createRadialGradient(700, 238, 0, 700, 238, 140)
  sun.addColorStop(0, 'rgba(255,244,224,1)')
  sun.addColorStop(0.12, 'rgba(255,226,180,0.95)')
  sun.addColorStop(1, 'rgba(255,190,130,0)')
  g.fillStyle = sun
  g.fillRect(0, 0, 1024, 512)
  const tints = ['#c98a80', '#a85c58', '#86393b', '#5a1b1f']
  for (const [i, tint] of tints.entries()) {
    g.fillStyle = tint
    g.beginPath()
    g.moveTo(0, 512)
    for (let x = 0; x <= 1024; x += 16) {
      const y = 262 + i * 24 + Math.sin(x * 0.012 + i * 1.7) * 14 + Math.sin(x * 0.031 + i) * 6
      g.lineTo(x, y)
    }
    g.lineTo(1024, 512)
    g.fill()
  }
  const painting = new CanvasTexture(canvas)
  painting.colorSpace = SRGBColorSpace
  // Equirect UVs change fast near the poles, so mipmaps would leave a blurry spot there.
  painting.generateMipmaps = false
  painting.minFilter = LinearFilter
  return painting
}

// Liquid metal drop, the nearest object in the scene. Reflects the sunset, wobbles, and stretches
// towards the pointer on hover.
export default effect({}, { animate: 'visible' }, ({ place, mask, u, layer, pose, onDispose }) => {
  const mirrored = sunset()
  onDispose(() => mirrored.dispose())

  const pull = uniform(0)
  const towards = uniform(vec3(0, 0, 1))
  const p = positionLocal
  const n = normalLocal
  const clock = u.time.mul(0.35)
  // Product of sines instead of noise. Looks the same here and compiles much faster.
  const wave = (q: Node<'vec3'>, k: number) =>
    sin(q.x.mul(2.9 * k).add(clock.mul(1.1)))
      .mul(sin(q.y.mul(3.3 * k).sub(clock.mul(0.8))))
      .mul(sin(q.z.mul(3.1 * k).add(clock.mul(1.3))))
  const wobble = wave(p, 1)
  const reach = n.dot(towards).max(0).pow(3)
  const material = new MeshBasicNodeMaterial({ transparent: true })
  material.positionNode = p.add(n.mul(wobble.mul(0.026).add(reach.mul(pull))))

  // The equirect u is mirrored so the painting has no seam where its edges meet.
  const tremor = vec3(wave(p, 1.8), wave(p.yzx, 1.8), wave(p.zxy, 1.8))
  const bent = normalize(normalWorld.add(tremor.mul(pull.add(0.1))))
  const view = normalize(positionWorld.sub(cameraPosition))
  const r = reflect(view, bent)
  const around = equirectUV(r)
  const env = texture(mirrored, vec2(around.x.mul(2).sub(1).abs(), around.y)).rgb
  const facing = bent.dot(view.negate()).max(0)
  const fresnel = float(1).sub(facing).pow(3)
  const sunDir = normalize(vec3(0.35, 0.12, 0.6))
  const spec = r.dot(sunDir).max(0).pow(60)
  material.colorNode = env
    .mul(mix(vec3(0.95, 0.85, 0.78), vec3(1.08), fresnel))
    .add(WARM.mul(spec.mul(1.6)))
  material.opacityNode = mask(vec2(0.5, 0.5))
  const drop = place(new Mesh(new IcosahedronGeometry(0.42, 48), material), {
    fit: 'contain',
    replace: true,
  })

  return (input) => {
    const k = Math.min(1, input.delta * 4)
    pull.value += (input.hover * 0.12 * touchable(hero.flight) - pull.value) * k
    towards.value.set((input.pointer.x - 0.5) * 2, (input.pointer.y - 0.5) * 2, 0.6).normalize()
    // Hidden once the camera has flown past it. A posed layer counts as on screen, so the pose
    // goes with it: the page below the hero draws nothing for the drop.
    drop.visible = nearFade(DEPTH.metal, hero.flight) > 0
    pose(layer, inScene(input, DEPTH.metal, hero.flight), drop.visible ? 1 : 0)
  }
})
