import { effect } from '@dioramajs/diorama'
import {
  clamp,
  float,
  instancedBufferAttribute,
  mix,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl'
import { InstancedBufferAttribute, Sprite, SpriteNodeMaterial } from 'three/webgpu'
import { DEPTH, hero, inScene, nearFade, touchable } from './_hero'
import { arch, glare, glareAt, lightOf, papers, WARM } from './_look'

// A portrait split into sprite grains, each showing its own piece of the image. At rest they tile
// it exactly. Under the pointer they scatter and rise.
export default effect(
  { columns: 66 },
  { media: true, rebuild: ['columns'], animate: 'visible' },
  ({ element, map, coverUV, mask, place, params, u, layer, pose }) => {
    const cols = params.columns
    const rows = Math.round((cols * 4) / 3)
    const n = cols * rows
    const cells = new Float32Array(n * 2)
    const seeds = new Float32Array(n)
    // Random offsets from the CPU. Shader noise would slow down compilation.
    const strays = new Float32Array(n * 3).map(() => Math.random() - 0.5)
    for (let i = 0; i < n; i++) {
      cells[i * 2] = ((i % cols) + 0.5) / cols
      cells[i * 2 + 1] = (Math.floor(i / cols) + 0.5) / rows
      seeds[i] = Math.random()
    }
    const cell = instancedBufferAttribute<'vec2'>(new InstancedBufferAttribute(cells, 2), 'vec2')
    const seed = instancedBufferAttribute<'float'>(new InstancedBufferAttribute(seeds, 1), 'float')
    const stray = instancedBufferAttribute<'vec3'>(new InstancedBufferAttribute(strays, 3), 'vec3')

    // Grains are only a few px wide, so any depth offset at rest would open gaps in perspective.
    // They shimmer in brightness instead.
    const home = cell.sub(0.5).mul(u.size)
    const shimmer = sin(u.time.mul(0.9).add(seed.mul(40)))
      .mul(sin(u.time.mul(0.37).add(seed.mul(17))))
      .mul(0.05)
    const touch = uniform(1)
    const toPointer = home.sub(u.pointer.sub(0.5).mul(u.size))
    const near = clamp(float(1).sub(toPointer.length().div(130)), 0, 1)
      .pow(2)
      .mul(u.hover, touch)
    const aside = vec3(toPointer.add(vec2(1e-4, 0)).normalize().mul(near.mul(38)), near.mul(90))
    const drift = stray.mul(vec3(36, 36, 60)).mul(near)

    const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false })
    material.positionNode = vec3(home, 0).add(aside).add(drift)
    material.scaleNode = u.size.x.div(cols).mul(mix(1.04, seed.mul(0.8).add(0.7), near.mul(0.7)))
    const at = uniform(0.45)
    const piece = uv().sub(0.5).div(vec2(cols, rows))
    const light = glare(cell, at)
    const paper = papers(lightOf(element, map, coverUV), cell.add(piece), vec2(1, 1).div(u.size))
    const shape = arch(cell.add(piece), u.size, float(0))
    material.colorNode = paper.mul(
      WARM.mul(light.mul(0.22)).add(1).add(shimmer),
      shape.rim.mul(0.3).add(1),
    )
    const round = smoothstep(0.5, 0.4, uv().sub(0.5).length())
    // mask() carries the element's opacity, so grains fade with it during a flight.
    material.opacityNode = mix(float(1), round.mul(mix(1, 0.8, seed)), near.min(1)).mul(
      mask(cell),
      shape.inside,
    )

    const grains = new Sprite(material)
    grains.count = n
    grains.frustumCulled = false
    place(grains, { fit: 'none', replace: true })

    return (input) => {
      at.value = glareAt()
      touch.value = touchable(hero.flight)
      // Hide before the camera reaches it. Sprites crossing the camera plane streak.
      grains.visible = nearFade(DEPTH.portrait, hero.flight) > 0
      // Posed layers count as on screen: no pose once it is hidden, so it stops drawing.
      pose(layer, inScene(input, DEPTH.portrait, hero.flight), grains.visible ? 1 : 0)
    }
  },
)
