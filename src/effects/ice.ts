import { effect } from 'diorama'
import {
  abs,
  clamp,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  screenUV,
  select,
  sign,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  viewportMipTexture,
} from 'three/tsl'
import type { Node, TextureNode } from 'three/webgpu'
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  RedFormat,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
} from 'three/webgpu'
import { type Baked, bakeAll, DETAIL, RELIEF } from './_ice-bake'

/** Frost regrowth time over a wiped spot and the delay before it starts, s. */
const REGROW = 6
const HOLD = 0.8
/** CSS px per melt map cell. */
const CELL = 5
/** Apparent slab thickness in px. The back face shows inside the front, towards screen centre. */
const DEPTH = 56
/** Seconds for the first frost to cover the clear slab. */
const FIRST = 3.2

let baking: Promise<Baked> | undefined

/** Baked once per page in a worker so the page keeps drawing. Falls back to the main thread. */
function bake(): Promise<Baked> {
  baking ??= new Promise<Baked>((done, fail) => {
    const worker = new Worker(new URL('./_ice-worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<Baked>) => {
      done(e.data)
      worker.terminate()
    }
    worker.onerror = (e) => {
      worker.terminate()
      fail(e)
    }
    worker.postMessage('bake')
  }).catch(() => bakeAll())
  return baking
}

const hash = (p: Node<'vec2'>): Node<'float'> =>
  fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453))

const map = (data: Uint8Array, width: number, height: number): DataTexture => {
  const t = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType)
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
  return t
}

// A thick slab of lake ice over whatever the page draws behind it. Being in the same scene it can
// refract that light, split colours at the edges and scatter it under frost, which
// backdrop-filter can't do. The pointer melts the frost and it grows back after a moment.
export default effect(
  { frost: 1, brush: 72 },
  { animate: 'visible' },
  async ({ place, mask, u, render, params, onDispose, signal }) => {
    const baked = await bake()
    if (signal.aborted) return
    const relief = map(baked.relief, RELIEF.width, RELIEF.height)
    const detail = map(baked.detail, DETAIL.width, DETAIL.height)
    const frost = map(baked.frost, DETAIL.width, DETAIL.height)

    // Above 0 where the pointer has passed, decays to 0 as the frost regrows.
    let cols = 0
    let rows = 0
    let melt = new Float32Array(0)
    let meltBytes = new Uint8Array(1)
    let meltMap = new DataTexture(meltBytes, 1, 1, RedFormat, UnsignedByteType)
    const meltNode = texture(meltMap)
    const cell = uniform(new Vector2(1, 1))
    const resize = (c: number, r: number): void => {
      const next = new Float32Array(c * r)
      for (let j = 0; j < r && cols && rows; j++) {
        for (let i = 0; i < c; i++) {
          next[j * c + i] = melt[
            Math.floor((j / r) * rows) * cols + Math.floor((i / c) * cols)
          ] as number
        }
      }
      cols = c
      rows = r
      melt = next
      meltBytes = new Uint8Array(c * r)
      // A different size needs a new GPU texture.
      meltMap.dispose()
      meltMap = new DataTexture(meltBytes, c, r, RedFormat, UnsignedByteType)
      meltMap.magFilter = meltMap.minFilter = LinearFilter
      meltMap.needsUpdate = true
      meltNode.value = meltMap
      melting = true
      cell.value.set(1 / c, 1 / r)
    }
    onDispose(() => {
      relief.dispose()
      detail.dispose()
      frost.dispose()
      meltMap.dispose()
    })

    const view = uniform(new Vector2(1, 1))
    const texel = uniform(new Vector2(1, 1))
    const centre = uniform(new Vector2(0, 0))
    const light = uniform(new Vector2(0, 0))
    const warmth = uniform(0)
    const grown = uniform(0)
    const shown = uniform(0)
    const amount = uniform(1)

    const p = uv()
    const S = u.size
    const c = p.sub(0.5).mul(S)
    const half = S.mul(0.5)

    // Bakes fill the box like object-fit: cover.
    const k = S.x.div(S.y).div(2)
    const at = p
      .sub(0.5)
      .mul(vec2(min(k, 1), min(float(1).div(k), 1)))
      .add(0.5)
    const rel = texture(relief, at)
    const det = texture(detail, at)
    const fro = texture(frost, at)
    const fog = texture(frost, at).level(float(4.5))

    // Rounded box with a slightly melted, uneven edge.
    const bevel = clamp(min(S.x, S.y).mul(0.03), 9, 16)
    const radius = float(30)
    const sdf = (q0: Node<'vec2'>) => {
      const q = abs(q0).sub(half).add(radius)
      return length(max(q, 0))
        .add(min(max(q.x, q.y), 0))
        .sub(radius)
    }
    const melted = rel.b.sub(0.5).mul(9).add(rel.a.sub(0.5).mul(2.5))
    const d = sdf(c).add(melted)
    const inside = smoothstep(0.75, -0.75, d)
    const q = abs(c).sub(half).add(radius)
    const qp = max(q, 0)
    const corner = length(qp)
    const s = sign(c.add(0.0001))
    const out = select(
      corner.greaterThan(0.001),
      qp.div(max(corner, 0.001)).mul(s),
      select(q.x.greaterThan(q.y), vec2(s.x, 0), vec2(0, s.y)),
    )
    const kb = clamp(d.div(bevel).add(1), 0, 1)

    // Back face, DEPTH px behind, appears smaller and pulled towards screen centre. Between the
    // two outlines you're looking through a side wall.
    const shrink = render.camera.position.z / (render.camera.position.z + DEPTH)
    const back = sdf(centre.add(c).div(shrink).sub(centre)).add(melted)
    const wall = smoothstep(-1.5, 2, back).mul(inside)
    const across = clamp(back.div(DEPTH * 0.6), 0, 1)
    const backLine = exp(back.div(1.2).pow(2).negate()).mul(inside, kb.oneMinus())

    // The meltwater edge round a wiped spot refracts too.
    const m0 = meltNode.sample(p).r
    const mx = meltNode
      .sample(p.add(vec2(cell.x, 0)))
      .r.sub(meltNode.sample(p.sub(vec2(cell.x, 0))).r)
    const my = meltNode
      .sample(p.add(vec2(0, cell.y)))
      .r.sub(meltNode.sample(p.sub(vec2(0, cell.y))).r)
    const water = vec2(mx, my)

    // Surface normal from the bevel, relief, inner detail and meltwater.
    const nSurf = rel.xy.sub(0.5).mul(2)
    const nDet = det.xy.sub(0.5).mul(4)
    const lift = kb.pow(2).mul(1.1).add(kb.pow(6).mul(2.4))
    const n = out.mul(lift).add(nSurf.mul(0.8)).add(nDet).add(water.mul(-0.5))

    // Frost regrows from the edges in, hoar first, then needles and ferns, heavier near the
    // edges as on a window pane. Thin hoar melts first, so the melt edge is ragged.
    const regrow = clamp(float(1).sub(m0.mul(mix(0.7, 1.3, rel.a))), 0, 1).mul(grown)
    const edge = smoothstep(min(S.x, S.y).mul(0.5), 0, d.negate())
    const order = fro.g.mul(0.75).add(edge.oneMinus().mul(0.25))
    const sprout = smoothstep(order.sub(0.05), order.add(0.05), regrow.mul(1.08).sub(0.04))
    const veil = rel.a.mul(mix(0.35, 1, edge)).mul(smoothstep(0, 0.6, regrow), amount)
    const crystals = clamp(
      fro.r.mul(mix(0.6, 1, edge)).add(fro.b.mul(mix(0.5, 0.95, edge))),
      0,
      1,
    ).mul(sprout, amount)
    // Scatter uses a blurred copy of the growth so the blur level doesn't jump between crystals.
    const soft = smoothstep(
      0.08,
      -0.08,
      fog.g.mul(0.75).add(edge.oneMinus().mul(0.25)).sub(regrow.mul(1.08).sub(0.04)),
    )
    const scatter = clamp(veil.mul(0.75).add(fog.r.add(fog.b).mul(soft, amount, 1.4)), 0, 1)

    // The backdrop, refracted, with chromatic split and blurred under frost. Light seen through a
    // side wall has travelled inside the slab, so it's pulled in and brighter.
    const grain = hash(floor(at.mul(vec2(DETAIL.width, DETAIL.height))))
    const jitter = vec2(grain.sub(0.5), hash(at.mul(913.7)).sub(0.5)).mul(scatter.mul(9))
    const bend = n
      .mul(-22)
      .add(nSurf.mul(-40))
      .sub(out.mul(wall.mul(across.mul(36).add(10))))
    const shift = vec2(bend.x, bend.y.negate()).div(view)
    const behind = viewportMipTexture() as TextureNode
    const sharp = kb.mul(0.6).add(wall.mul(0.6))
    const tap = (scale: number) => behind.sample(screenUV.add(shift.mul(scale))).level(sharp)
    const clear = vec3(tap(0.94).r, tap(1).g, tap(1.07).b)
    // Under frost, four taps one mip finer, rotated per pixel so the square mip texels dissolve
    // into the frost grain.
    const level = clamp(scatter.mul(4.4), 0, 4.6)
    const spread = pow(float(2), level.sub(0.4)).mul(texel)
    const through = screenUV.add(shift).add(vec2(jitter.x, jitter.y.negate()).div(view))
    const spin = grain.mul(Math.PI * 2)
    const r = vec2(cos(spin), sin(spin)).mul(0.8)
    const blur = (o: Node<'vec2'>) =>
      behind.sample(through.add(o.mul(spread))).level(level.sub(1).max(0)).rgb
    const blurred = blur(r)
      .add(blur(vec2(r.y.negate(), r.x)))
      .add(blur(r.negate()))
      .add(blur(vec2(r.y, r.x.negate())))
      .mul(0.25)
    const seen = mix(clear, blurred, smoothstep(0.02, 0.3, scatter))

    // Thicker ice tints blue, plus a faint glow of its own.
    const thick = rel.b.mul(0.5).add(0.5).add(wall.mul(0.6))
    let colour: Node<'vec3'> = seen
      .mul(mix(vec3(1, 1, 1), vec3(0.62, 0.86, 1), thick.mul(0.6)))
      .mul(wall.mul(0.35).add(1))
      .add(vec3(0.003, 0.009, 0.016).mul(thick))

    // Two lights, the warm pointer close in front and the moon high to the right.
    const N = normalize(vec3(n, 1))
    const L = normalize(vec3(light.sub(c), 150))
    const H = normalize(L.add(vec3(0, 0, 1)))
    const wet = m0.min(1).mul(grown)
    // Small hot glint on facing facets and a broad sheen, glossier where wet.
    const facet = pow(max(dot(N, H), 0), 700).mul(warmth)
    const sheen = pow(max(dot(N, H), 0), 36).mul(warmth, wet.mul(0.06).add(0.025))
    const warm = facet.add(sheen)
    const moonH = normalize(normalize(vec3(0.5, 0.62, 0.6)).add(vec3(0, 0, 1)))
    const moon = pow(max(dot(N, moonH), 0), 220)
    const fresnel = pow(float(1).sub(N.z), 5).mul(0.85).add(0.025)
    colour = mix(colour, vec3(0.025, 0.04, 0.075), fresnel)

    // Fracture planes and bubble walls with a thin-film shimmer. Near the pointer they light up
    // regardless of orientation.
    const near = exp(length(light.sub(c)).div(130).pow(2).negate()).mul(warmth)
    const flash = facet.mul(1.2).add(sheen.mul(9)).add(moon).add(near.mul(0.7))
    const film = cos(
      vec3(0, 2.1, 4.2)
        .add(det.b.mul(7))
        .add(dot(N.xy, vec2(8, 5))),
    )
      .mul(0.5)
      .add(0.5)
    const silver = mix(vec3(0.42, 0.52, 0.62), film.mul(0.6), 0.35)
    colour = colour.add(silver.mul(det.b.mul(flash.add(0.17))))
    colour = colour.add(vec3(0.55, 0.64, 0.75).mul(det.a.mul(flash.mul(1.4).add(0.16))))

    // The bevel lip catches the moon on the upper right, side walls glow a little, and the back
    // face shows as a faint line.
    const facing = max(dot(out, normalize(vec2(0.62, 0.78))), 0)
    const lip = exp(d.add(1).div(0.8).pow(2).negate())
    const shoulder = exp(d.add(bevel.mul(0.55)).div(1.6).pow(2).negate())
    // Light travelling inside the slab tints its edges deep green-blue.
    colour = colour.mul(mix(vec3(1, 1, 1), vec3(0.5, 0.78, 0.86), kb.pow(1.5).mul(0.75)))
    colour = colour
      .add(vec3(0.55, 0.66, 0.78).mul(lip.mul(facing.mul(1.1).add(0.14))))
      .add(vec3(0.12, 0.3, 0.32).mul(shoulder.mul(facing.oneMinus().mul(0.5).add(0.15))))
      .add(vec3(0.05, 0.1, 0.14).mul(kb.pow(3).mul(0.6).add(backLine.mul(0.5))))
    colour = colour.add(vec3(1, 0.72, 0.45).mul(warm)).add(vec3(0.75, 0.85, 1).mul(moon.mul(1.1)))

    // Frost on top picks up the scattered backdrop colour, a little moonlight and warmth near the
    // pointer. Each crystal has its own facing, so they glint one by one as the light moves.
    const lit = seen
      .mul(2.2)
      .add(vec3(0.03, 0.045, 0.075).mul(p.y.mul(0.5).add(0.6)))
      .add(vec3(0.3, 0.14, 0.05).mul(near))
    colour = mix(colour, lit, veil.mul(0.4))
    colour = mix(colour, lit.mul(1.5).add(vec3(0.05, 0.07, 0.1)), crystals.mul(0.8))
    const id = floor(at.mul(vec2(DETAIL.width, DETAIL.height).div(2)))
    const turn = hash(id).mul(Math.PI * 2)
    const toward = normalize(light.sub(c).add(0.001))
    const glint = smoothstep(0.97, 1, dot(vec2(cos(turn), sin(turn)), toward))
      .mul(smoothstep(0.86, 0.94, hash(id.add(31))))
      .mul(crystals, warmth, smoothstep(420, 60, length(light.sub(c))))
    colour = colour
      .add(vec3(1, 0.93, 0.82).mul(glint.mul(1.6)))
      .add(vec3(0.05, 0.02, 0.006).mul(near))

    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
    material.colorNode = vec4(colour, 1)
    material.opacityNode = inside.mul(mask(), shown)
    const slab = new Mesh(new PlaneGeometry(1, 1), material)
    // Draw last so the viewport copy it samples already has the aurora in it.
    slab.renderOrder = 10
    slab.position.z = 0.5
    place(slab, { replace: true })

    const size = new Vector2()
    const pixels = new Vector2()
    const last = { x: 0, y: 0, on: false }
    /** Skip updating and uploading the melt map once nothing is melting. */
    let melting = false
    let since = 0
    const PEAK = 1 + HOLD / REGROW
    /** Soft capsule from a to b, `r` cells wide, in melt map cells. */
    const stamp = (ax: number, ay: number, bx: number, by: number, r: number): void => {
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r))
      const x1 = Math.min(cols - 1, Math.ceil(Math.max(ax, bx) + r))
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r))
      const y1 = Math.min(rows - 1, Math.ceil(Math.max(ay, by) + r))
      const dx = bx - ax
      const dy = by - ay
      const len2 = dx * dx + dy * dy
      for (let j = y0; j <= y1; j++) {
        for (let i = x0; i <= x1; i++) {
          const cx = i + 0.5
          const cy = j + 0.5
          const t =
            len2 > 0 ? Math.min(1, Math.max(0, ((cx - ax) * dx + (cy - ay) * dy) / len2)) : 0
          const dist = Math.hypot(cx - (ax + dx * t), cy - (ay + dy * t)) / r
          if (dist >= 1) continue
          const v = (1 - dist * dist) ** 1.6 * PEAK
          const index = j * cols + i
          if (v > (melt[index] as number)) melt[index] = v
        }
      }
    }

    return (input) => {
      const c0 = Math.max(4, Math.round(input.width / CELL))
      const r0 = Math.max(4, Math.round(input.height / CELL))
      if (c0 !== cols || r0 !== rows) resize(c0, r0)
      render.renderer.getSize(size)
      view.value.copy(size)
      render.renderer.getDrawingBufferSize(pixels)
      texel.value.set(1 / pixels.x, 1 / pixels.y)
      centre.value.set(
        input.x + input.width / 2 - size.x / 2,
        size.y / 2 - (input.y + input.height / 2),
      )
      amount.value = params.frost

      // Fade in, then the first frost grows.
      const dt = Math.min(0.1, input.delta)
      since += dt
      const intro = input.reducedMotion ? 1 : Math.min(1, Math.max(0, (since - 0.5) / FIRST))
      grown.value = intro * intro * (3 - 2 * intro)
      const fade = input.reducedMotion ? 1 : Math.min(1, since / 0.8)
      shown.value = fade * fade * (3 - 2 * fade)

      // The light trails the pointer and rests up left when it leaves.
      const on = input.over
      const tx = on ? (input.pointer.x - 0.5) * input.width : -input.width * 0.2
      const ty = on ? (input.pointer.y - 0.5) * input.height : input.height * 0.24
      const ease = 1 - Math.exp(-dt * 14)
      light.value.x += (tx - light.value.x) * ease
      light.value.y += (ty - light.value.y) * ease
      warmth.value += ((on ? 1 : 0.15) - warmth.value) * (1 - Math.exp(-dt * 4))

      if (on) {
        const x = input.pointer.x * cols
        const y = input.pointer.y * rows
        // Smaller brush on small slabs, where it's a fingertip on a phone.
        const reach =
          params.brush * Math.min(1, Math.max(0.55, Math.min(input.width, input.height) / 600))
        stamp(last.on ? last.x : x, last.on ? last.y : y, x, y, Math.max(2, reach / CELL))
        last.x = x
        last.y = y
        melting = true
      }
      last.on = on
      if (!melting) return
      const fall = dt / REGROW
      melting = false
      for (let i = 0; i < melt.length; i++) {
        const v = Math.max(0, (melt[i] as number) - fall)
        melt[i] = v
        meltBytes[i] = Math.round(Math.min(1, v) * 255)
        if (v > 0) melting = true
      }
      meltMap.needsUpdate = true
    }
  },
)
