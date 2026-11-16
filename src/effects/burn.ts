import { effect } from 'diorama'
import {
  clamp,
  color,
  exp,
  float,
  fwidth,
  instancedBufferAttribute,
  min,
  mix,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node } from 'three/webgpu'
import {
  InstancedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Sprite,
  SpriteNodeMaterial,
  Vector2,
  Vector3,
  Vector4,
} from 'three/webgpu'
import { extent, type Field, fieldAt, fields, hash, noiseTexture, seeded } from './_burn-field'

// Band widths in px, measured from the front into the paper.
const EMBER = 4.5
const CHAR = 17
const SCORCH = 26
const SPILL = 7
// Entering: soft edge width, and how far behind it the picture still looks warm.
const SOFT = 26
const WARMTH = 140
// How far the glow on the wall reaches past the box.
const PAD = 72
// The fire is out by this point of the leave, the rest of the time lets sparks die.
const BURN = 0.84
const MAX_SPARKS = 240

const SUN = color('#ffcf98')
const WHITE_HOT = color('#fff1dc')
const ORANGE = color('#ff8a3c')
const FLAME = color('#ff9046')
const RED = color('#b8261a')
const DEEP = color('#3d0806')
const CHARRED = color('#140807')
const ASH = color('#2b1a17')
const WARM_CAST = vec3(1.1, 0.97, 0.86)
const TOAST = vec3(0.48, 0.29, 0.17)

/** Edge colour by heat: deep red at 0, sun-white at 1. */
function ember(heat: Node<'float'>): Node<'vec3'> {
  const low = mix(DEEP, RED, smoothstep(0, 0.35, heat))
  const high = mix(
    ORANGE,
    mix(SUN, WHITE_HOT, smoothstep(0.92, 1, heat)),
    smoothstep(0.7, 0.95, heat),
  )
  return mix(low, high, smoothstep(0.3, 0.72, heat))
}

const fade = (from: number | Node<'float'>, to: number | Node<'float'>, x: Node<'float'>) =>
  smoothstep(from, to, x).oneMinus()

// Page transition for images: the old picture burns away like paper, the new one blooms in warm.
// With `presence: 'custom'` the effect gets the copy's presence (1 to 0 on leave, 0 to 1 on
// enter) and draws it as fire instead of the default fade. At rest it draws the image untouched.
export default effect(
  { sparks: 1, glow: 1, seed: 0 },
  {
    media: true,
    presence: 'custom',
    bleed: 170,
    animate: ({ input }) => input.presence < 1,
  },
  ({ element, surface, u, place, params, onDispose }) => {
    const noise = noiseTexture()
    onDispose(() => noise.dispose())

    // Field params are uniforms so switching between leave and enter needs no recompile.
    const edge = uniform(new Vector2(0, 1e5))
    const points = [0, 1, 2].map(() => uniform(new Vector4(0, 0, 0, 0)))
    const climb = uniform(new Vector2(1, 1))
    const shape = uniform(new Vector3(400, 0, 0))
    const front = uniform(-1e5)
    // 0 on leave (paper is above the front), 1 on enter (paper is below it).
    const mode = uniform(0)
    // Runs past 1, up to 1/BURN, while the sparks die out.
    const burnt = uniform(0)
    const light = uniform(0)
    const t = u.time

    const field = (px: Node<'vec2'>, size: Node<'vec2'>, ragged = true) => {
      let d: Node<'float'> = min(min(px.x, size.x.sub(px.x)), min(px.y, size.y.sub(px.y)))
        .mul(edge.x)
        .add(edge.y)
      for (const p of points) {
        const q = px.sub(p.xy)
        const up = q.y.mul(select(q.y.greaterThan(0), climb.x, climb.y))
        d = min(d, vec2(q.x, up).length().div(p.z.max(1e-3)).add(p.w))
      }
      const n = texture(noise, px.div(shape.x))
      const f = d.add(n.r.sub(0.5).mul(shape.y))
      return { f: ragged ? f.add(n.g.sub(0.5).mul(shape.z)) : f, vary: n.g }
    }
    // Positive where paper remains.
    const side = (f: Node<'float'>) => f.sub(front).mul(mode.mul(-2).add(1))
    const flicker = (px: Node<'vec2'>) =>
      texture(noise, px.div(130).add(vec2(t.mul(0.05), t.mul(-0.23))))
        .a.mul(0.9)
        .add(0.55)

    surface.color((c, { box }) => {
      const px = box.mul(u.size)
      const { f, vary } = field(px, u.size)
      const k = side(f)
      const flick = flicker(px)

      // From the paper inwards: toast, char with a few embers, glowing front, then light
      // spilling a few px past the edge.
      const heat = clamp(k.div(vary.mul(0.8).add(0.6).mul(EMBER)).oneMinus(), 0, 1)
      const charEdge = vary.mul(0.7).add(0.65).mul(CHAR)
      const toast = fade(charEdge, SCORCH, k).pow(1.7)
      const charred = fade(charEdge.mul(0.55), charEdge, k)
      const specks = smoothstep(0.8, 0.95, texture(noise, px.div(220)).b).mul(
        fade(EMBER, charEdge, k),
        heat.oneMinus(),
        flick,
      )
      let burning = c.rgb.mul(mix(vec3(1), TOAST, toast.mul(0.9)))
      burning = mix(burning, CHARRED, charred).add(ORANGE.mul(specks.mul(0.85)))
      burning = mix(burning, ember(heat).mul(flick.mul(0.3).add(0.8)), smoothstep(0.08, 0.6, heat))
      const aa = fwidth(f).max(0.3)
      const paper = smoothstep(aa.negate(), aa, k)
      const spill = smoothstep(-SPILL, 0, k).mul(paper.oneMinus(), flick.mul(0.75))
      const left = paper.add(spill)
      burning = burning
        .mul(paper)
        .add(ember(float(0.78)).mul(spill))
        .div(left.max(1e-4))

      const appearing = c.rgb.mul(mix(vec3(1), WARM_CAST, fade(0, WARMTH, k).pow(1.5)))
      const shown = smoothstep(-SOFT, SOFT * 0.5, k)

      return vec4(mix(burning, appearing, mode), mix(left, shown, mode).mul(c.a))
    })

    // Firelight on the wall behind the sheet, visible around it and through the holes. Each
    // pixel samples the field at the nearest point of the sheet and falls off with distance.
    const span = uniform(new Vector2(1, 1))
    const glow = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
    {
      const px = uv().sub(0.5).mul(span).add(u.size.mul(0.5))
      const near = clamp(px, vec2(0, 0), u.size)
      const out = px.sub(near)
      const away = out.length()
      // Five taps along the edge, spread wider with distance. One tap looks like a point light.
      const along = select(out.x.abs().greaterThan(out.y.abs()), vec2(0, 1), vec2(1, 0)).mul(
        away.mul(0.32),
      )
      let lit: Node<'float'> = float(0)
      for (const step of [-2, -1, 0, 1, 2]) {
        const k = side(field(clamp(near.add(along.mul(step)), vec2(0, 0), u.size), u.size, false).f)
        lit = lit.add(exp(k.abs().div(away.mul(-0.5).sub(14))).div(5))
      }
      lit = lit.mul(exp(away.div(-20)), fade(PAD * 0.45, PAD * 0.95, away))
      glow.colorNode = FLAME
      glow.opacityNode = lit.mul(light, flicker(px), 0.55)
    }
    const wall = new Mesh(new PlaneGeometry(1, 1), glow)
    wall.position.z = -1
    wall.renderOrder = -1
    wall.frustumCulled = false
    place(wall, { fit: 'none' })

    // Birth times come from the CPU copy of the field, so the shader only computes age.
    const spot = new Float32Array(MAX_SPARKS * 4)
    const flight = new Float32Array(MAX_SPARKS * 4)
    const spotAttr = new InstancedBufferAttribute(spot, 4)
    const flightAttr = new InstancedBufferAttribute(flight, 4)
    const at = instancedBufferAttribute<'vec4'>(spotAttr, 'vec4')
    const how = instancedBufferAttribute<'vec4'>(flightAttr, 'vec4')
    const on = uniform(0)
    const sparkMaterial = new SpriteNodeMaterial({ transparent: true, depthWrite: false })
    {
      // About 20% are ash flakes: dark and slower.
      const ash = smoothstep(0.8, 0.82, how.x)
      const age = burnt.sub(at.z).div(at.w)
      const alive = smoothstep(0, 0.02, age).mul(fade(0.96, 1, age))
      const a = clamp(age, 0, 1)
      const rise = float(1)
        .sub(a)
        .pow(2)
        .oneMinus()
        .mul(how.z, mix(1, 0.45, ash))
      const sway = sin(a.mul(7).add(how.x.mul(40))).mul(a, 5)
      sparkMaterial.positionNode = vec3(
        at.xy.sub(u.size.mul(0.5)).add(vec2(how.y.mul(a, 46).add(sway), rise)),
        a.mul(30).add(1),
      )
      sparkMaterial.scaleNode = how.w.mul(a.mul(-0.65).add(1), alive, on)
      sparkMaterial.colorNode = mix(
        mix(mix(SUN, ORANGE, smoothstep(0, 0.4, a)), RED, smoothstep(0.4, 1, a)),
        ASH,
        ash,
      )
      const r = uv().sub(0.5).length().mul(2)
      const dot = mix(
        fade(0.12, 0.32, r)
          .add(fade(0, 1, r).pow(3).mul(0.5))
          .min(1),
        fade(0.2, 0.6, r),
        ash,
      )
      sparkMaterial.opacityNode = dot.mul(a.oneMinus().pow(1.3), alive, mix(1, 0.8, ash))
    }
    const sparks = new Sprite(sparkMaterial)
    sparks.count = 0
    sparks.renderOrder = 1
    sparks.frustumCulled = false
    place(sparks, { fit: 'none' })

    let width = 0
    let height = 0
    let seed = Number.NaN
    let many = 0
    let leave: Field | undefined
    let enter: Field | undefined
    let range: { leave: [number, number]; enter: [number, number] } = {
      leave: [0, 1],
      enter: [0, 1],
    }
    let state: 'rest' | 'enter' | 'leave' = 'rest'

    const use = (f: Field, entering: boolean): void => {
      edge.value.set(f.edge[0], f.edge[1])
      for (const [i, p] of f.points.entries()) points[i]?.value.set(p.x, p.y, p.speed, p.delay)
      climb.value.set(f.climb[0], f.climb[1])
      shape.value.set(f.tile, f.amp, f.fine)
      mode.value = entering ? 1 : 0
    }

    const measure = (w: number, h: number): void => {
      width = w
      height = h
      seed = params.seed
      const fresh = fields(w, h, hash(`${element.getAttribute('src') ?? ''} ${params.seed}`))
      leave = fresh.leave
      enter = fresh.enter
      range = { leave: extent(leave), enter: extent(enter) }
      const [lo, hi] = range.leave
      const from = lo - SCORCH - 2
      const to = hi + SPILL + 2
      const random = seeded(hash(`${w}x${h} ${params.seed}`))
      many = Math.max(48, (w * h) / 1000)
      for (let i = 0; i < MAX_SPARKS; i++) {
        const x = random() * w
        const y = random() * h
        const birth = (fieldAt(leave, x, y) - from) / (to - from)
        // Late sparks must die before the copy is removed.
        const life = Math.min(0.22 + random() * 0.38, 1 / BURN - birth - 0.02)
        spot.set([x, y, birth, Math.max(0.04, life)], i * 4)
        const kind = random()
        const rise = 60 + random() * 170
        flight.set(
          [kind, random() * 2 - 1, rise, kind > 0.8 ? 7 + random() * 4 : 6 + random() * 6],
          i * 4,
        )
      }
      spotAttr.needsUpdate = true
      flightAttr.needsUpdate = true
      span.value.set(w + PAD * 2, h + PAD * 2)
    }

    return (input) => {
      if (
        Math.abs(input.width - width) > 0.5 ||
        Math.abs(input.height - height) > 0.5 ||
        params.seed !== seed
      ) {
        measure(input.width, input.height)
      }
      if (!leave || !enter) return
      const p = input.presence
      // Decide once, when the copy leaves rest: detached element burns, connected one appears.
      // A copy removed mid-appear keeps 'enter' and recedes the way it came.
      const was = state
      state = p >= 1 ? 'rest' : state === 'rest' ? (element.isConnected ? 'enter' : 'leave') : state
      const leaving = state === 'leave'
      if (state === 'enter') {
        use(enter, true)
        const [lo, hi] = range.enter
        const r = 1 - (1 - p) ** 2.2
        const from = lo - SOFT * 2
        front.value = from + (hi + WARMTH + SOFT * 2 - from) * r
        light.value = 0
      } else if (leaving) {
        use(leave, false)
        const [lo, hi] = range.leave
        const b = (1 - p) / BURN
        const from = lo - SCORCH - 2
        const to = hi + SPILL + 2
        front.value = from + (to - from) * Math.min(1, b)
        burnt.value = b
        light.value = params.glow * Math.min(1, b / 0.08) * Math.max(0, Math.min(1, (1 - b) / 0.12))
      } else {
        front.value = mode.value > 0.5 ? 1e5 : -1e5
        light.value = 0
      }
      if (leaving !== (was === 'leave')) {
        // A burning copy goes on top of the new page so its holes and glow show over the new
        // images. Otherwise the wall light stays underneath.
        surface.mesh.renderOrder = leaving ? 2 : 0
        wall.renderOrder = leaving ? 1 : -1
        sparks.renderOrder = leaving ? 3 : 1
      }
      sparks.count = Math.round(Math.min(MAX_SPARKS, many * Math.max(0, params.sparks)))
      on.value = leaving ? Math.min(1, p / 0.06) : 0
      // Scaled to nothing instead of `visible = false`, so it stays compiled and the first burn
      // doesn't stall on a shader compile.
      const lit = light.value > 0
      wall.scale.set(lit ? width + PAD * 2 : 1e-3, lit ? height + PAD * 2 : 1e-3, 1)
    }
  },
)
