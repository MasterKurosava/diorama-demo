import { effect } from 'dioramajs'
import {
  atan,
  clamp,
  color,
  dot,
  exp,
  float,
  fract,
  instancedBufferAttribute,
  mix,
  screenUV,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node } from 'three/webgpu'
import {
  DataTexture,
  DataUtils,
  Euler,
  Group,
  HalfFloatType,
  InstancedBufferAttribute,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Quaternion,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  Sprite,
  SpriteNodeMaterial,
  UnsignedByteType,
  Vector3,
  Vector4,
} from 'three/webgpu'
import { arrived, D, DEPTH, eye, hero, PIVOT, smooth, sunk } from './_hero'

/** Planes overscan the screen so turning the eye never shows an edge. */
const OVERSCAN = 1.34

// Cut-paper ridges, far to near. `mist` is the haze in the valley below each one.
const RIDGES = [
  { base: 0.46, amp: 0.1, freq: 1.4, seed: 3, tint: '#c98a80', z: -1700, mist: 0.55 },
  { base: 0.4, amp: 0.12, freq: 1.9, seed: 7, tint: '#a85c58', z: -1150, mist: 0.45 },
  { base: 0.34, amp: 0.12, freq: 2.4, seed: 11, tint: '#86393b', z: -740, mist: 0.36 },
  { base: 0.29, amp: 0.11, freq: 2.9, seed: 17, tint: '#6d282b', z: -420, mist: 0.26 },
  { base: 0.24, amp: 0.09, freq: 3.3, seed: 23, tint: '#5a1b1f', z: -90, mist: 0.14 },
  { base: 0.15, amp: 0.08, freq: 2.2, seed: 29, tint: '#4b1519', z: 170, mist: 0 },
] as const
const SKY_Z = -2600
const SUN = [0.7, 0.62] as const
const MOON = [0.26, 0.76] as const
/** The same papers under moonlight. */
const NIGHT = ['#4a3d63', '#3a2d52', '#2d2143', '#231835', '#1a1129', '#130c20'] as const
/** The dusk papers, a little rosier. */
const DAWN = ['#d39a8e', '#b2686a', '#8f4248', '#733036', '#5e2127', '#4d181d'] as const

/** Noise span covered by the skyline texture, wider than any screen needs. */
const REACH = 12

/** Seeded so the ridges keep their shapes between visits. */
function seeded(seed: number): () => number {
  let a = seed * 2654435761
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Noise is baked into textures here. Noise functions in the shader make it slow to compile, and
// the browser draws nothing while the GPU compiles.

/** Four-octave fractal noise along x, one row per ridge. */
function skylines(): DataTexture {
  const width = 2048
  const data = new Uint16Array(width * RIDGES.length)
  for (const [row, r] of RIDGES.entries()) {
    const random = seeded(r.seed)
    const slopes = Array.from({ length: 512 }, () => random() * 2 - 1)
    const perlin = (x: number): number => {
      const i = Math.floor(x)
      const f = x - i
      const a = (slopes[i & 511] ?? 0) * f
      const b = (slopes[(i + 1) & 511] ?? 0) * (f - 1)
      return (a + (b - a) * f * f * f * (f * (f * 6 - 15) + 10)) * 2
    }
    const row0 = new Float32Array(width)
    for (let c = 0; c < width; c++) {
      let x = (c / width) * REACH
      let v = 0
      let amp = 1
      for (let o = 0; o < 4; o++) {
        v += perlin(x) * amp
        x *= 2.1
        amp *= 0.48
      }
      row0[c] = v
    }
    // Normalise to the range of the shader noise this replaced, whose peaks rarely passed 0.65.
    const peak = row0.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-6)
    for (let c = 0; c < width; c++)
      data[row * width + c] = DataUtils.toHalfFloat(((row0[c] ?? 0) / peak) * 0.65)
  }
  const map = new DataTexture(data, width, RIDGES.length, RedFormat, HalfFloatType)
  map.magFilter = map.minFilter = LinearFilter
  map.needsUpdate = true
  return map
}

/** Tiling value noise, 8 cells a side, an independent layer per channel. */
function haze(): DataTexture {
  const side = 256
  const cells = 8
  const data = new Uint8Array(side * side * 4)
  const random = seeded(41)
  for (let ch = 0; ch < 4; ch++) {
    const lattice = Array.from({ length: cells * cells }, random)
    const at = (i: number, j: number): number =>
      lattice[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)] ?? 0
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const u = (x / side) * cells
        const v = (y / side) * cells
        const i = Math.floor(u)
        const j = Math.floor(v)
        const su = (u - i) ** 2 * (3 - 2 * (u - i))
        const sv = (v - j) ** 2 * (3 - 2 * (v - j))
        const a = at(i, j)
        const b = at(i + 1, j)
        const c = at(i, j + 1)
        const d = at(i + 1, j + 1)
        const value = a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv
        data[(y * side + x) * 4 + ch] = Math.round(value * 255)
      }
    }
  }
  const map = new DataTexture(data, side, side, RGBAFormat, UnsignedByteType)
  map.wrapS = map.wrapT = RepeatWrapping
  map.magFilter = map.minFilter = LinearFilter
  map.needsUpdate = true
  return map
}

interface Piece {
  readonly mesh: Mesh
  readonly z: number
  readonly fade: { value: number }
  readonly overscan: number
  /** How much of the flight it follows. The far sky barely moves. */
  readonly pace: number
}

// Backdrop the page stands in: dusk sky with a low sun and rays, six cut-paper ridges with mist,
// and dust in the light. Page elements sit among the ridges at their own depths, so they turn
// with the scene when the pointer moves the eye. `hour` is 0 at dusk, 0.5 at night, 1 at dawn.
// With `fly` (the hero) scroll flies the eye in and the pointer turns it, otherwise it's still.
export default effect(
  { hour: 0, fly: true },
  { animate: 'visible' },
  ({ place, u, params, render, signal, onDispose }) => {
    const lines = skylines()
    const noise = haze()
    onDispose(() => {
      lines.dispose()
      noise.dispose()
    })
    /** Noise in -1..1, one cell per unit. */
    const smoothNoise = (
      at: Node<'vec2'>,
      ch: 'r' | 'g' | 'b' | 'a',
      vertex = false,
    ): Node<'float'> => {
      const read = texture(noise, at.div(8))
      return (vertex ? read.level(float(0)) : read)[ch].mul(2).sub(1)
    }
    const night = clamp(u.hour.mul(2), 0, 1).sub(clamp(u.hour.mul(2).sub(1), 0, 1))
    const day = (dusk: string, dark: string, dawn: string): Node<'vec3'> =>
      mix(
        mix(color(dusk), color(dark), clamp(u.hour.mul(2), 0, 1)),
        color(dawn),
        clamp(u.hour.mul(2).sub(1), 0, 1),
      )
    const size = uniform(vec2(1, 1))
    const shown = uniform(0)
    /** Drops below 1 as the hero's photo reaches its frame, so it never covers the sun. */
    const sunUp = uniform(1)
    // Clip the oversized planes to the element's box (canvas uv, top left origin), so a scene
    // further down rises with its chapter instead of covering the one above.
    const box = uniform(new Vector4(0, 0, 1, 1))
    // Non-hero scenes fade in over their top 160 px.
    const feather = uniform(0)
    // The hero scene fades into the wall at its bottom as it scrolls away.
    const foot = uniform(1e-4)
    const inBox = step(box.x, screenUV.x)
      .mul(step(screenUV.x, box.z), step(screenUV.y, box.w))
      .mul(smoothstep(box.y, box.y.add(feather), screenUV.y))
      .mul(smoothstep(box.w, box.w.sub(foot), screenUV.y))
    const aspect = size.x.div(size.y)
    const t = u.time

    const world = new Group()
    const pieces: Piece[] = []

    // Sky, the wall's red overhead and warm at the horizon.
    {
      const p = uv()
      const sunk = u.hour.mul(2).sub(1).abs().oneMinus().mul(0.34)
      const sun = vec2(SUN[0], float(SUN[1]).sub(sunk))
      const from = p.sub(sun).mul(vec2(aspect, 1))
      const d = from.length()
      const dir = from.div(d.max(1e-4))
      // Rays are noise by angle around the sun, tiling once per turn.
      const turn = atan(dir.y, dir.x).div(Math.PI * 2)
      const rays = smoothNoise(vec2(turn.mul(32), t.mul(0.04)), 'r')
        .mul(0.5)
        .add(0.5)
        .pow(3)
        .mul(exp(d.mul(-2.4)), smoothstep(0.05, 0.12, d))
      const glow = exp(p.y.sub(0.5).abs().mul(-4))
      // Keep the left darker so the text over it reads.
      const shade = smoothstep(0.62, 0.05, p.x).mul(smoothstep(0.35, 0.75, p.y), 0.45)
      const overhead = smoothstep(0.62, 0.8, p.y).mul(0.4)
      const lit = night.oneMinus()
      const air = mix(
        day('#4b1519', '#0c0a1d', '#5a2233'),
        day('#e39a76', '#2e2548', '#f0a98f'),
        glow.mul(0.85),
      )
        .mul(shade.oneMinus())
        .add(
          day('#f7dcb9', '#f7dcb9', '#fbe3cf')
            .mul(exp(d.mul(-8)).mul(0.55))
            .mul(lit),
        )
        .add(color('#ffd9ad').mul(rays.mul(0.5)).mul(lit))
        .mul(overhead.mul(lit.mul(0.5).add(0.5)).oneMinus())
      // Small hot sun disc in its bloom. At night a small cold moon across the sky, and stars.
      const moonFrom = p.sub(vec2(MOON[0], MOON[1])).mul(vec2(aspect, 1)).length()
      const cell = p.mul(vec2(aspect, 1)).mul(90)
      const seed = fract(sin(dot(cell.floor(), vec2(41.3, 289.1))).mul(15731.743))
      const star = step(0.986, seed)
        .mul(smoothstep(0.32, 0.05, cell.fract().sub(0.5).length()))
        .mul(
          sin(t.mul(1.3).add(seed.mul(80)))
            .mul(0.35)
            .add(0.65),
          smoothstep(0.42, 0.8, p.y),
        )
      const sky = air
        .add(
          color('#ffcf98')
            .mul(exp(d.mul(-38)).mul(0.65))
            .mul(lit, sunUp),
        )
        .add(
          color('#fff6e6')
            .mul(smoothstep(0.034, 0.026, d))
            .mul(lit, sunUp),
        )
        .add(
          color('#9aa6d6')
            .mul(exp(moonFrom.mul(-30)).mul(0.35))
            .mul(night),
        )
        .add(
          color('#eef1ff')
            .mul(smoothstep(0.024, 0.018, moonFrom))
            .mul(night),
        )
        .add(color('#dfe5ff').mul(star).mul(night))
      const fade = uniform(1)
      const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
      material.colorNode = vec4(sky, 1)
      material.opacityNode = fade.mul(shown, inBox)
      const mesh = new Mesh(new PlaneGeometry(1, 1), material)
      world.add(mesh)
      pieces.push({ mesh, z: SKY_Z, fade, overscan: OVERSCAN * 1.25, pace: 0.15 })
    }

    for (const [i, r] of RIDGES.entries()) {
      const p = uv()
      const x = p.x.mul(aspect)
      // Ridges rise into place on arrival, far ones first.
      const lift = smoothstep(i * 0.08, 0.55 + i * 0.08, shown)
        .oneMinus()
        .mul(0.5)
      const skyline = texture(lines, vec2(x.mul(r.freq / REACH), (i + 0.5) / RIDGES.length)).r
      const ridge = skyline.mul(r.amp).add(r.base).sub(lift)
      const aa = float(1.2).div(size.y)
      const inside = smoothstep(ridge.add(aa), ridge.sub(aa), p.y)
      // Fine grain, a lit cut edge, darker towards the foot, drifting mist in the valley.
      const grain = fract(
        sin(dot(p.mul(size).floor(), vec2(12.9898, 78.233)).add(r.seed)).mul(43758.5453),
      )
        .sub(0.5)
        .mul(0.05)
        .add(1)
      const edge = smoothstep(ridge.sub(0.014), ridge.sub(0.002), p.y).mul(0.24).add(1)
      const body = mix(float(0.78), float(1), smoothstep(ridge.sub(0.32), ridge, p.y))
      const drift = smoothNoise(vec2(x.mul(2.2).sub(t.mul(0.03)), p.y.mul(7).add(r.seed * 3)), 'g')
        .mul(0.35)
        .add(0.65)
      const mist = smoothstep(ridge.sub(0.05), ridge.sub(0.26), p.y).mul(r.mist, drift)
      const tint = day(r.tint, NIGHT[i] ?? r.tint, DAWN[i] ?? r.tint)
      const paper = mix(
        tint.mul(grain).mul(edge).mul(body),
        day('#e2a18c', '#3e3560', '#f0b3a0'),
        mist,
      )
      const shadow = smoothstep(ridge.add(0.05), ridge, p.y).mul(inside.oneMinus(), 0.36)
      const floor = r.z > 0 ? smoothstep(0.02, 0.12, p.y) : float(1)
      const fade = uniform(1)
      const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
      material.colorNode = vec4(mix(day('#140405', '#04030a', '#140405'), paper, inside), 1)
      material.opacityNode = inside.add(shadow).min(1).mul(floor, fade, shown, inBox)
      const mesh = new Mesh(new PlaneGeometry(1, 1), material)
      world.add(mesh)
      pieces.push({ mesh, z: r.z, fade, overscan: OVERSCAN, pace: 1 })
    }

    // Dust in depth bands so it sorts with the ridges and page elements.
    const travel = uniform(0)
    const lift = uniform(0)
    const side = uniform(0)
    const gone = uniform(1)
    const dust = (count: number, z0: number, z1: number, px: [number, number]) => {
      const seeds = new Float32Array(count * 4).map(() => Math.random())
      const s = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(seeds, 4), 'vec4')
      const up = fract(s.y.add(t.mul(s.w.mul(0.01).add(0.004))))
      const sway = smoothNoise(vec2(s.x.mul(9).add(s.w.mul(5)), t.mul(0.08)), 'b', true).mul(40)
      const z = mix(float(z0), float(z1), s.z).add(travel)
      const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false })
      material.positionNode = vec3(
        s.x.sub(0.5).mul(size.x, 1.5).add(sway).sub(side),
        up.sub(0.3).mul(size.y, 1.1).sub(lift),
        z.sub(PIVOT),
      )
      // Hide motes near the eye. A sprite crossing the camera plane smears across the screen.
      material.scaleNode = mix(float(px[0]), float(px[1]), s.w).mul(step(z, D - 60))
      const twinkle = smoothNoise(vec2(s.x.mul(40).add(s.z.mul(17)), t.mul(0.6)), 'a')
        .mul(0.4)
        .add(0.6)
      const disc = smoothstep(0.5, 0, uv().sub(0.5).length())
      material.colorNode = day('#ffe2bd', '#cfd8ff', '#fff0dc')
      material.opacityNode = disc.mul(
        twinkle,
        smoothstep(0, 0.15, up),
        smoothstep(1, 0.8, up),
        smoothstep(D - 40, D - 320, z),
        gone,
        shown,
        inBox,
        0.55,
      )
      const sprite = new Sprite(material)
      sprite.count = count
      sprite.frustumCulled = false
      world.add(sprite)
    }
    dust(280, -1600, -800, [2, 5])
    dust(170, -700, -100, [3, 7])
    dust(30, 0, 420, [9, 22])

    const turn = new Group()
    turn.position.z = PIVOT
    turn.add(world)
    for (const piece of pieces) piece.mesh.position.z = piece.z - PIVOT
    place(turn, { fit: 'none' })

    // Turn the whole scene around the pivot so page elements turn with the ridges.
    const scene = render.scene
    const pivot = new Vector3(0, 0, PIVOT)
    const q = new Quaternion()
    const euler = new Euler()
    const turned = new Vector3()
    const level = (): void => {
      scene.quaternion.identity()
      scene.position.set(0, 0, 0)
    }
    signal.addEventListener('abort', level)
    const canvas = render.renderer.domElement
    return ({ x, y, width, height, delta }) => {
      size.value.set(width, height)
      const c = canvas.getBoundingClientRect()
      box.value.set(
        (x - c.left) / c.width,
        (y - c.top) / c.height,
        (x + width - c.left) / c.width,
        (y + height - c.top) / c.height,
      )
      feather.value = params.fly ? 1e-4 : 160 / c.height
      // Zero while the hero fills the screen, up to 280 px as its bottom scrolls up.
      const risen = c.bottom - (y + height)
      foot.value = params.fly ? Math.max(1e-4, Math.min(280, risen)) / c.height : 1e-4
      shown.value = params.fly ? arrived() : 1
      const f = params.fly ? hero.flight : 0
      sunUp.value = 1 - smooth(0.62, 0.8, f)

      if (params.fly) {
        // The eye follows the pointer a little, less as it flies in. It stays level during the
        // arrival so the sun rises exactly where the loader's sun was, and after the fly-through.
        const free =
          hero.reduced || !hero.pointer.moved ? 0 : (1 - smooth(0.4, 0.9, f)) * arrived(1200, 1500)
        const k = f > 0.97 ? 1 : Math.min(1, delta * 3)
        hero.view.yaw += (hero.pointer.x * 0.2 * free - hero.view.yaw) * k
        hero.view.pitch += (hero.pointer.y * 0.08 * free - hero.view.pitch) * k
        euler.set(hero.view.pitch, hero.view.yaw, 0)
        q.setFromEuler(euler)
        turned.copy(pivot).applyQuaternion(q)
        scene.quaternion.copy(q)
        scene.position.copy(pivot).sub(turned)
      }

      const e = eye(f)
      // Dim into the wall behind the card the photo lands in.
      const out = 1 - 0.7 * smooth(0.75, 1, f)
      // Lower the hills in front of the photo, in screen px, so it stands clear in its frame.
      const down = sunk(f) * height * 0.6
      travel.value = e.z
      lift.value = e.y
      side.value = e.x
      gone.value = out
      for (const { mesh, z, fade, overscan, pace } of pieces) {
        // Scale by (D - z) / D so the plane covers the screen at rest.
        const depth = z + e.z * pace
        const s = ((D - z) / D) * overscan
        const drop = z > DEPTH.photo ? (down * Math.max(0, D - depth)) / D : 0
        mesh.scale.set(width * s, height * s, 1)
        mesh.position.set(-e.x * pace, -e.y * pace - drop, depth - PIVOT)
        fade.value = smooth(D - 60, D - 380, depth) * out
      }
    }
  },
)
