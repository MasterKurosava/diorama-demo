import type { EffectContext } from 'dioramajs'
import { effect } from 'dioramajs'
import {
  abs,
  cameraPosition,
  clamp,
  color,
  exp,
  float,
  fract,
  fwidth,
  instancedBufferAttribute,
  max,
  min,
  mix,
  modelWorldMatrixInverse,
  positionGeometry,
  round,
  sign,
  smoothstep,
  step,
  texture,
  uniform,
  uniformArray,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node } from 'three/webgpu'
import {
  DataTexture,
  Group,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  RGFormat,
  UnsignedByteType,
  Vector3,
  Vector4,
} from 'three/webgpu'
import { grainAt, tone, WARM } from './_look'
import {
  blur,
  bounds,
  type Ground,
  ground,
  half,
  haze,
  type Peak,
  relief,
  sample,
  seeded,
  stamp,
} from './_terrain'

/** Relief texels per side. Wide boxes get the finer grid since their contours run long. */
const GRID = [256, 384] as const
/** Mountains with their own stamp and glow. Extra peaks share them. */
const MAX = 8
/** Model width in model units, depth follows the box. */
const WIDTH = 1000
/** Distance behind the page in px. Further back means a longer lens and less distortion. */
const BACK = 650
/** Sun direction in the model plane (right and away) and the tangent of its elevation. */
const SUN = [0.6, 0.8] as const
const SUN_RISE = 0.72
/** Glide stiffness, 1/s. Critically damped, settles in about a second. */
const SPRING = 4.2

/** Stamps per seed, kept for the visit since they're slow to compute. */
const stamps = new Map<number, Promise<Float32Array[]>>()
function mountains(seed: number): Promise<Float32Array[]> {
  let made = stamps.get(seed)
  if (!made) {
    made = (async () => {
      const out: Float32Array[] = []
      // Yield between stamps so the page keeps drawing.
      for (let i = 0; i < MAX; i++) {
        await new Promise((done) => setTimeout(done))
        out.push(stamp(seed * 31 + i))
      }
      return out
    })()
    stamps.set(seed, made)
  }
  return made
}

interface Mount {
  readonly element: HTMLElement
  readonly box: EffectContext['input']
  readonly slot: number
  /** Current pose, target and per-axis velocity for u, v, h, r. */
  readonly now: Peak
  readonly to: Peak
  readonly speed: [number, number, number, number]
  /** Delay before the first rise, s. */
  wait: number
  hover: number
  /** Summit height, eased so the label glides between terraces. */
  z: number
  gone: boolean
  /** Last values written to style, to skip redundant writes. */
  written: { x: number; y: number; alt: number }
}

// Topographic relief under the HTML. Each peak inside the element (a link placed by CSS) raises
// a mountain where its box stands, `--h` high. The land is a stack of paper sheets cut along the
// contours, like an architect's model, lit by a low sun with mist in the valleys. Labels stay
// HTML. The effect writes each summit's screen offset to `--summit-x` / `--summit-y` (px from
// the peak's box centre) and its elevation to `--alt`, and the page CSS moves the label there.
export default effect(
  { peaks: '.peak', tilt: 52, layers: 14, relief: 0.2, turn: 8, fill: 0.88, seed: 3 },
  { animate: 'visible', rebuild: ['layers', 'seed'] },
  async ({ element, params, u, input, place, layers, render, signal, invalidate, onDispose }) => {
    const sheetsN = Math.max(6, Math.min(24, Math.round(params.layers)))
    const seed = Math.round(params.seed)
    const made = await mountains(seed)
    if (signal.aborted) return

    const side = (input.width || window.innerWidth) > 820 ? GRID[1] : GRID[0]
    const heights = new Uint16Array(side * side * 2)
    const map = new DataTexture(heights, side, side, RGFormat, HalfFloatType)
    map.magFilter = map.minFilter = LinearFilter
    const air = new DataTexture(haze(128, 4, seed), 128, 128, RGBAFormat, UnsignedByteType)
    air.wrapS = air.wrapT = RepeatWrapping
    air.magFilter = air.minFilter = LinearFilter
    air.needsUpdate = true
    onDispose(() => {
      map.dispose()
      air.dispose()
    })

    // Instance 0 is the base board, the rest are contour sheets bottom to top. Drawn in that
    // order a higher sheet always covers a lower one from above, so no depth test is needed.
    const count = sheetsN + 1
    const sheetData = new Float32Array(count * 4)
    const areaData = new Float32Array(count * 4)
    const sheetAttr = new InstancedBufferAttribute(sheetData, 4)
    const areaAttr = new InstancedBufferAttribute(areaData, 4)
    const sheet = instancedBufferAttribute<'vec4'>(sheetAttr, 'vec4')
    const area = instancedBufferAttribute<'vec4'>(areaAttr, 'vec4')
    const size = uniform(vec2(WIDTH, WIDTH))
    const step1 = uniform(10)
    /** Arrival, 0..1. The model fades in while its sheets lift off the board. */
    const open = uniform(0)
    const shown = smoothstep(0, 0.4, open)
    /** Per slot: u, v, radius, hover. */
    const spots = Array.from({ length: MAX }, () => new Vector4(0, 0, 0.1, 0))
    const glow = uniformArray(spots, 'vec4')

    const level = sheet.z
    const base = step(level, float(-0.5))
    const zTop = sheet.x.mul(open)
    const thick = mix(sheet.y.mul(open).max(1e-3), sheet.y, base)
    // The quad also has to cover the walls its sheet shows towards the eye.
    const margin = vec2(thick.mul(2.4).add(4), thick.mul(2.4).add(4)).div(size)
    const corner = positionGeometry.xy.add(0.5)
    const at = mix(area.xy.sub(margin), area.zw.add(margin), corner)
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
    material.positionNode = vec3(at.sub(0.5).mul(size), zTop)
    const p = varying(at)

    const rectOut = (x: Node<'vec2'>) => {
      const e = abs(x.sub(0.5)).sub(0.5)
      return max(e.x, e.y)
    }
    const inside = (x: Node<'vec2'>) =>
      clamp(float(0.5).sub(rectOut(x).div(fwidth(x).length().mul(0.7).max(1e-6))), 0, 1)
    const above = (d: Node<'float'>) => clamp(d.div(fwidth(d).max(1e-6)).add(0.5), 0, 1)

    // Follow the eye ray to the sheet's underside. If this sheet has land there, we're looking at
    // its cut edge.
    const eye = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz
    const ray = vec3(p.sub(0.5).mul(size), zTop).sub(eye)
    const run = ray.xy.div(ray.z.negate().max(1e-3))
    const q = p.add(run.mul(thick).div(size))
    const here = texture(map, p)
    const hp = here.r
    const hq = texture(map, q).r
    const top = inside(p).mul(above(hp.sub(level)))
    const below = inside(q).mul(above(hq.sub(level)))
    const wall = top.oneMinus().mul(below)
    const alpha = top.add(wall).min(1)
    const walled = wall.div(alpha.max(1e-4))

    // Where the ray crosses the edge (share of sheet thickness) and which way the edge faces,
    // the board's sides or downhill.
    const offBoard = step(0, rectOut(p))
    const ro = rectOut(p)
    const crossTerrain = level.sub(hp).div(hq.sub(hp).max(1e-4))
    const crossBoard = ro.div(ro.sub(rectOut(q)).max(1e-5))
    const cross = clamp(mix(crossTerrain, crossBoard, offBoard), 0, 1)
    const c = mix(p, q, cross)
    const g = mix(p, c, walled)
    const texel = vec2(1 / side, 1 / side)
    const g0 = texture(map, g).g
    const slope = vec2(
      texture(map, g.add(vec2(texel.x, 0))).g.sub(g0),
      texture(map, g.add(vec2(0, texel.y))).g.sub(g0),
    )
      .div(texel)
      .div(size)
    const downhill = slope.negate().div(slope.length().max(1e-6))
    const ce = abs(c.sub(0.5))
    const boardSide = mix(
      vec2(0, sign(c.y.sub(0.5))),
      vec2(sign(c.x.sub(0.5)), 0),
      step(ce.y, ce.x),
    )
    const facing = mix(downhill, boardSide, offBoard)
    const sun = vec2(SUN[0], SUN[1]).normalize()
    const lit = facing.dot(sun)

    // Hovered mountains brighten their contours.
    let glowing: Node<'float'> = float(0)
    const aspect = size.y.div(size.x)
    for (let i = 0; i < MAX; i++) {
      const m = glow.element(i) as unknown as Node<'vec4'>
      const d = p.sub(m.xy).mul(vec2(1, aspect)).length()
      glowing = max(glowing, m.w.mul(smoothstep(m.z.mul(1.3), m.z.mul(0.45), d)))
    }

    // Sheet face, shaded where higher sheets block the sun.
    const n = float(sheetsN)
    const paper = tone(sheet.w).mul(grainAt(p.mul(size), vec2(1, 1)))
    const throw1 = sun.mul(step1.mul(open).div(SUN_RISE)).div(size)
    // Land `sheets` higher, `far` sheet heights towards the sun, softened by `soft` sheets.
    const towards = (far: number, sheets: number, soft: number) => {
      const there = texture(map, p.add(throw1.mul(far))).g
      return smoothstep(-soft, soft, there.sub(level.add(sheets / sheetsN)).mul(n))
    }
    // The sheet above shades a band along its foot, a mountain throws a long soft shadow.
    const shade = max(
      max(towards(1, 1, 0.4), towards(2.2, 2, 0.5).mul(0.85)),
      towards(5, 4.5, 1).mul(0.6),
    )
      .mul(0.44)
      .mul(base.oneMinus())
    // Fine pale line along the cut, brighter where it faces the sun.
    const fromEdge = min(
      hp.sub(level).div(fwidth(hp).max(1e-6)),
      rectOut(p).negate().div(fwidth(p).length().mul(0.7).max(1e-6)),
    )
    const rim = smoothstep(2.1, 0.9, fromEdge).mul(top)
    // Etched contours between cuts, about a pixel wide at any scale, faded where they crowd.
    const x5 = hp.mul(n.mul(5))
    const w5 = fwidth(x5).max(1e-5)
    const etch = clamp(float(1).sub(abs(fract(x5.add(0.5)).sub(0.5)).div(w5)), 0, 1)
      .mul(step(0.5, abs(round(x5).sub(round(x5.div(5)).mul(5)))))
      .mul(smoothstep(0.32, 0.14, w5))
      .mul(base.oneMinus())
    const cream = color('#f3e9d8')
    const warmth = p.x.mul(0.55).add(p.y.mul(0.45)).mul(0.26).add(0.86)
    // Shade goes towards the wall's red, not grey.
    const dusk = vec3(0.56, 0.36, 0.37)
    let face: Node<'vec3'> = paper
      .mul(mix(vec3(1, 1, 1), dusk, shade), warmth)
      .add(WARM.mul(glowing.mul(0.05)))
    face = mix(face, cream, etch.mul(glowing.mul(0.55).add(0.13)))
    face = mix(face, cream, rim.mul(lit.max(0).mul(0.4).add(0.22).add(glowing.mul(0.45)).min(1)))

    // Cut edge seen side-on, lit by the sun and darker towards its foot.
    const cut = tone(sheet.w)
      .mul(mix(dusk.mul(1.05), vec3(1, 0.95, 0.92), smoothstep(-0.7, 0.8, lit)))
      .mul(cross.mul(-0.12).add(1))
      .add(WARM.mul(lit.max(0).mul(0.06)))
    // Base board, dark wine with a lit hairline along the top.
    const lip = smoothstep(0.12, 0.02, cross)
    const board = mix(color('#2e0b0e'), color('#4a1519'), cross.oneMinus().pow(2))
      .mul(lit.mul(0.12).add(1))
      .add(cream.mul(lip.mul(0.22)))
    const edge = mix(cut, board, base)

    // Mist pools in the valleys, thicker over low sheets.
    const mistTop = step1.mul(2.8)
    const z = zTop.sub(walled.mul(cross).mul(thick))
    const deep = mistTop.sub(z).max(0)
    const mid = p.sub(run.mul(deep.mul(0.5)).div(size))
    const t = u.time
    // Two long banks drifting different ways.
    const drift1 = texture(
      air,
      mid.mul(size.div(vec2(900, 260))).add(vec2(t.mul(0.012), t.mul(0.002))),
    ).r
    const drift2 = texture(
      air,
      mid.mul(size.div(vec2(420, 150))).add(vec2(t.mul(-0.007), t.mul(0.003))),
    ).g
    const mist = deep
      .div(mistTop)
      .pow(1.2)
      .mul(smoothstep(0.32, 0.78, drift1.mul(0.62).add(drift2.mul(0.38))))
      .mul(inside(mid))
      .mul(0.3)

    const col = mix(mix(face, edge, walled), color('#d99a88'), mist)
    material.colorNode = vec4(col, 1)
    material.opacityNode = alpha.mul(u.opacity, shown)
    const sheets = new InstancedMesh(new PlaneGeometry(1, 1), material, count)
    sheets.frustumCulled = false
    sheets.renderOrder = 1

    // Shadow on the table, offset away from the sun.
    const shadowMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
    const sp = positionGeometry.xy.mul(1.5)
    const drop = sp.add(vec2(SUN[0], SUN[1]).mul(0.05))
    const out = abs(drop).sub(0.5).mul(size)
    const reach = max(out.x, out.y)
    shadowMat.colorNode = vec4(color('#140405'), 1)
    shadowMat.opacityNode = smoothstep(120, -40, reach)
      .mul(exp(reach.max(0).mul(-0.012)))
      .mul(0.55, u.opacity, shown)
    shadowMat.positionNode = vec3(sp.mul(size), float(0))
    const shadow = new Mesh(new PlaneGeometry(1, 1), shadowMat)
    shadow.frustumCulled = false
    shadow.renderOrder = 0

    const body = new Group()
    body.add(shadow, sheets)
    const spin = new Group()
    spin.add(body)
    const lean = new Group()
    lean.add(spin)
    const model = new Group()
    model.add(lean)
    place(model, { fit: 'none' })

    const D = render.camera.position.z
    const shape = {
      width: 0,
      height: 0,
      aspect: 1,
      tilt: 0,
      scale: 1,
      lift: 0,
      relief: 1,
      step: 1,
      board: 1,
      pivot: 0,
    }
    let land: Ground | undefined
    /** Seconds since the last resize. The ground is rebuilt once it settles. */
    let settled = 0
    /** Rest pose (box centred on the eye, no pointer turn) and its inverse. */
    const matrix = new Matrix4()
    const inverse = new Matrix4()
    const part = new Matrix4()
    const v = new Vector3()
    const rest = () =>
      matrix
        .makeTranslation(0, shape.lift, -BACK)
        .multiply(part.makeScale(shape.scale, shape.scale, shape.scale))
        .multiply(part.makeRotationX(-shape.tilt))
        .multiply(part.makeTranslation(0, 0, -shape.pivot))
    const project = (m: Matrix4, x: number, y: number, z: number) => {
      v.set(x, y, z).applyMatrix4(m)
      const k = D / (D - v.z)
      return { x: v.x * k, y: v.y * k }
    }
    const reshape = (width: number, height: number) => {
      const tall = Math.min(1, Math.max(0, height / width - 1))
      shape.width = width
      shape.height = height
      shape.tilt = ((params.tilt - 12 * tall) * Math.PI) / 180
      shape.aspect = Math.min(
        1.75,
        Math.max(0.55, ((height / width) * 0.95) / Math.cos(shape.tilt)),
      )
      shape.relief = params.relief * WIDTH
      shape.step = shape.relief / sheetsN
      shape.board = shape.step * 2.2
      shape.pivot = shape.relief * 0.3
      shape.scale = 1
      shape.lift = 0
      const L = WIDTH * shape.aspect
      // Fit the board as seen into the box, a few rounds because of perspective. Summits may poke
      // out. Spare room goes above the model, where the labels sit.
      const seenBounds = () => {
        rest()
        const b = {
          x0: Number.POSITIVE_INFINITY,
          x1: Number.NEGATIVE_INFINITY,
          y0: Number.POSITIVE_INFINITY,
          y1: Number.NEGATIVE_INFINITY,
        }
        for (const cx of [-0.5, 0.5])
          for (const cy of [-0.5, 0.5])
            for (const cz of [-shape.board, shape.relief * 0.3]) {
              const s = project(matrix, cx * WIDTH, cy * L, cz)
              b.x0 = Math.min(b.x0, s.x)
              b.x1 = Math.max(b.x1, s.x)
              b.y0 = Math.min(b.y0, s.y)
              b.y1 = Math.max(b.y1, s.y)
            }
        return b
      }
      const roomX = width * params.fill
      const roomY = height * params.fill
      for (let i = 0; i < 5; i++) {
        const b = seenBounds()
        const k = Math.min(roomX / (b.x1 - b.x0), roomY / (b.y1 - b.y0))
        shape.scale *= k
        shape.lift -= ((b.y0 + b.y1) / 2) * k
      }
      const b = seenBounds()
      shape.lift -= Math.max(0, roomY - (b.y1 - b.y0)) * 0.3 * ((D + BACK) / D)
      inverse.copy(rest()).invert()
      size.value.set(WIDTH, L)
      step1.value = shape.step
      for (let i = 0; i < count; i++) {
        const j = i - 1
        sheetData.set(
          i === 0
            ? [0, shape.board, -1, 0]
            : [
                (j + 1) * shape.step,
                shape.step,
                j / sheetsN,
                0.3 + 5.7 * (j / (sheetsN - 1)) ** 0.9,
              ],
          i * 4,
        )
      }
      sheetAttr.needsUpdate = true
      body.position.z = -shape.pivot
      shadow.position.z = -shape.board - 0.5
      land ??= ground(side, side, shape.aspect, seed)
      settled = 0
    }

    /** Box point (px from centre, y up) to 0..1 on the low ground of the model at rest. */
    const ground0 = new Vector3()
    const normal = new Vector3()
    const lens = new Vector3()
    const sight = new Vector3()
    const onGround = (x: number, y: number): { u: number; v: number } => {
      ground0.set(0, 0, shape.step * (1 + 0.12 * sheetsN)).applyMatrix4(matrix)
      normal.set(0, Math.sin(shape.tilt), Math.cos(shape.tilt))
      lens.set(0, 0, D)
      sight.set(x, y, 0).sub(lens)
      const t = ground0.sub(lens).dot(normal) / sight.dot(normal)
      const hit = lens.addScaledVector(sight, t).applyMatrix4(inverse)
      const keep = (a: number) => Math.min(0.92, Math.max(0.08, a))
      return { u: keep(hit.x / WIDTH + 0.5), v: keep(hit.y / (WIDTH * shape.aspect) + 0.5) }
    }

    // Rebaked whenever a mountain moves.
    const height = new Float32Array(side * side)
    const softened = new Float32Array(side * side)
    const boxes = new Float32Array(sheetsN * 4)
    const bake = (list: Mount[]) => {
      if (!land) return
      relief(
        land,
        list.map((m) => m.now),
        list.map((m) => made[m.slot] as Float32Array),
        height,
      )
      blur(height, softened, side, side, 3)
      for (let i = 0; i < side * side; i++) {
        heights[i * 2] = half(height[i] ?? 0)
        heights[i * 2 + 1] = half(softened[i] ?? 0)
      }
      map.needsUpdate = true
      bounds(land, height, sheetsN, boxes)
      areaData.set([0, 0, 1, 1], 0)
      areaData.set(boxes, 4)
      areaAttr.needsUpdate = true
    }

    const found = layers(params.peaks)
    const mounts = new Map<Element, Mount>()
    const random = seeded(seed + 5)
    const order = Array.from({ length: MAX }, (_, i) => i).sort(() => random() - 0.5)
    const freeSlot = () => order.find((s) => ![...mounts.values()].some((m) => m.slot === s)) ?? 0
    const number = (style: CSSStyleDeclaration, name: string, fallback: number) => {
      const v = Number.parseFloat(style.getPropertyValue(name))
      return Number.isFinite(v) ? v : fallback
    }

    // Reduced motion has no free-running frames, so DOM changes and keyboard focus request one.
    const watch = new MutationObserver(invalidate)
    watch.observe(element, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['class', 'style', 'hidden'],
    })
    element.addEventListener('focusin', invalidate, { signal })
    element.addEventListener('focusout', invalidate, { signal })
    // Hand the labels back to plain CSS.
    onDispose(() => {
      watch.disconnect()
      for (const m of mounts.values()) {
        for (const name of ['--summit-x', '--summit-y', '--alt'])
          m.element.style.removeProperty(name)
      }
    })

    // Build the land here, not in the first frame, which already compiles the sheets.
    if (input.width > 1 && input.height > 1) {
      reshape(input.width, input.height)
      await new Promise((done) => setTimeout(done))
      if (signal.aborted) return
    }

    const chain = new Matrix4()
    const scene = render.scene
    const keys = ['u', 'v', 'h', 'r'] as const
    let dirty = true
    let turn = 0
    let pitch = 0
    let arrival = 0
    return (input) => {
      const still = input.reducedMotion
      const dt = Math.min(input.delta, 1 / 30)
      // Arrival plays once, when first seen.
      arrival = still ? 1 : Math.min(1, arrival + dt / 1.5)
      open.value = 1 - (1 - arrival) ** 3
      if (input.width !== shape.width || input.height !== shape.height) {
        if (input.width < 2 || input.height < 2) return
        reshape(input.width, input.height)
        dirty = true
      }
      // Rebuild the ground for a new aspect only once resizing settles. It's slow and a window
      // being dragged shouldn't pay for it every frame.
      settled += input.delta
      if (land && settled > 0.25 && Math.abs(land.aspect - shape.aspect) > 0.02) {
        land = ground(side, side, shape.aspect, seed)
        dirty = true
      }
      const cx = input.x + input.width / 2
      const cy = input.y + input.height / 2

      // A peak without a box (display: none) sinks away.
      const standing = found.filter((l) => l.input.width > 0 || l.input.height > 0)
      for (const layer of standing) {
        const el = layer.element as HTMLElement
        const box = layer.input
        const style = getComputedStyle(el)
        const h = Math.min(1, Math.max(0, number(style, '--h', 0.7)))
        const r = Math.min(0.35, Math.max(0.05, number(style, '--r', 0.13 + 0.1 * h)))
        const spot = onGround(box.x + box.width / 2 - cx, cy - (box.y + box.height / 2))
        let m = mounts.get(el)
        if (!m) {
          m = {
            element: el,
            box,
            slot: freeSlot(),
            now: { ...spot, h: 0, r },
            to: { ...spot, h, r },
            speed: [0, 0, 0, 0],
            wait: still || arrival >= 1 ? 0 : 0.6 + mounts.size * 0.14,
            hover: 0,
            z: Number.NaN,
            gone: false,
            written: { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, alt: -1 },
          }
          mounts.set(el, m)
        }
        m.gone = false
        Object.assign(m.to, spot, { h, r })
      }
      for (const m of mounts.values()) {
        if (standing.some((l) => l.element === m.element)) continue
        m.gone = true
        m.to.h = 0
      }

      // Critically damped spring per axis. New peaks wait their turn to rise.
      let changed = dirty
      for (const [el, m] of mounts) {
        if (m.wait > 0 && !still) {
          m.wait -= dt
          continue
        }
        for (const [i, key] of keys.entries()) {
          const target = m.to[key]
          const from = m.now[key]
          let speed = m.speed[i] ?? 0
          if (still) {
            m.now[key] = target
            speed = 0
          } else {
            speed += (SPRING * SPRING * (target - from) - 2 * SPRING * speed) * dt
            m.now[key] += speed * dt
            if (Math.abs(target - m.now[key]) < 1e-4 && Math.abs(speed) < 1e-4) {
              m.now[key] = target
              speed = 0
            }
          }
          m.speed[i] = speed
          if (m.now[key] !== from) changed = true
        }
        if (m.gone && m.now.h < 0.002) mounts.delete(el)
      }
      const list = [...mounts.values()]
      if (changed) bake(list)
      dirty = false

      const k = still ? 1 : 1 - Math.exp(-dt * 2.6)
      const over = input.over && !still
      turn += ((over ? (input.pointer.x - 0.5) * 2 * params.turn : 0) - turn) * k
      pitch += ((over ? (input.pointer.y - 0.5) * 2 * 2.5 : 0) - pitch) * k
      model.position.set(0, shape.lift, -BACK)
      model.scale.setScalar(shape.scale)
      lean.rotation.x = -shape.tilt + (pitch * Math.PI) / 180
      spin.rotation.z = (turn * Math.PI) / 180

      // Project each summit with the scene's own matrices for this frame, in px from its peak's
      // box centre.
      for (const o of [model, lean, spin, body]) o.updateMatrix()
      scene.updateMatrix()
      const centre = render.toWorld(cx, cy)
      const corner = render.toWorld(0, 0)
      chain
        .copy(scene.matrix)
        .multiply(part.makeTranslation(centre.x, centre.y, 0))
        .multiply(model.matrix)
        .multiply(lean.matrix)
        .multiply(spin.matrix)
        .multiply(body.matrix)
      for (const m of list) {
        const hover = m.element.matches(':hover, :focus-visible') ? 1 : 0
        m.hover = still ? hover : m.hover + (hover - m.hover) * (1 - Math.exp(-dt * 7))
        spots[m.slot]?.set(m.now.u, m.now.v, m.now.r, m.hover)
        if (!land) continue
        const summit = sample(land, height, m.now.u, m.now.v)
        const terrace = (Math.min(sheetsN - 1, Math.floor(summit * sheetsN)) + 1) * shape.step
        m.z =
          still || Number.isNaN(m.z) ? terrace : m.z + (terrace - m.z) * (1 - Math.exp(-dt * 12))
        const s = project(
          chain,
          (m.now.u - 0.5) * WIDTH,
          (m.now.v - 0.5) * WIDTH * shape.aspect,
          m.z * open.value,
        )
        const x = s.x - corner.x - (m.box.x + m.box.width / 2)
        const y = corner.y - s.y - (m.box.y + m.box.height / 2)
        const alt = Math.round(summit * 300) * 10
        const w = m.written
        const css = m.element.style
        if (Math.abs(x - w.x) > 0.05) {
          w.x = x
          css.setProperty('--summit-x', `${x.toFixed(2)}px`)
        }
        if (Math.abs(y - w.y) > 0.05) {
          w.y = y
          css.setProperty('--summit-y', `${y.toFixed(2)}px`)
        }
        if (alt !== w.alt) {
          w.alt = alt
          css.setProperty('--alt', String(alt))
        }
      }
      for (let s = 0; s < MAX; s++) if (!list.some((m) => m.slot === s)) spots[s]?.setW(0)
    }
  },
)
