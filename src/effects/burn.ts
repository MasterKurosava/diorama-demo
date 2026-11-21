import { effect } from 'dioramajs'
import {
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
  CanvasTexture,
  InstancedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Sprite,
  SpriteNodeMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Vector4,
} from 'three/webgpu'
import { extent, type Field, fieldAt, fields, hash, noiseTexture, seeded } from './_burn-field'
import { flame } from './_fire'
import { type Raster, raster } from './_raster'

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
const MAX_EMBERS = 28
// Room around drawn text for the glow of its letters.
const TEXT_PAD = 22
// Seconds for a smouldering edge to burn in to its limit after the page opens.
const GROW = 4.5

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
const TEXT_SOOT = vec3(0.26, 0.13, 0.07)

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

/**
 * Sparks and ash flakes rising from `at.xy` (box px, y up). `how` holds kind, drift, rise and
 * size; `age` runs 0 to 1 over a spark's life.
 */
function sparkSprite(
  at: Node<'vec4'>,
  how: Node<'vec4'>,
  age: Node<'float'>,
  on: Node<'float'>,
  size: Node<'vec2'>,
  travel: number,
): Sprite {
  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false })
  // About 20% are ash flakes: dark and slower.
  const ash = smoothstep(0.8, 0.82, how.x)
  const alive = smoothstep(0, 0.02, age).mul(fade(0.96, 1, age))
  const a = clamp(age, 0, 1)
  const rise = float(1)
    .sub(a)
    .pow(2)
    .oneMinus()
    .mul(how.z, mix(1, 0.45, ash))
  const sway = sin(a.mul(7).add(how.x.mul(40))).mul(a, 5)
  material.positionNode = vec3(
    at.xy.sub(size.mul(0.5)).add(vec2(how.y.mul(a, travel).add(sway), rise)),
    a.mul(30).add(1),
  )
  material.scaleNode = how.w.mul(a.mul(-0.65).add(1), alive, on)
  material.colorNode = mix(
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
  material.opacityNode = dot.mul(a.oneMinus().pow(1.3), alive, mix(1, 0.8, ash))
  const sprite = new Sprite(material)
  sprite.count = 0
  sprite.renderOrder = 1
  sprite.frustumCulled = false
  return sprite
}

/** Instances that smoulder now, so only they ask for time frames. */
const smouldering = new WeakSet<Element>()

// Page transition for images: the old picture burns away like paper, the new one blooms in warm.
// With `presence: 'custom'` the effect gets the copy's presence (1 to 0 on leave, 0 to 1 on
// enter) and draws it as fire instead of the default fade. At rest it draws the image untouched.
// With `smoulder` the side the `angle` points to (degrees, 0 is right, 90 up) keeps burning:
// its edge is gone, a ragged front glows along it with flames and sparks, and the char behind
// it fades inwards. The front breathes with the lantern's flame. On an element that isn't an
// image it burns the element's text, drawn where the browser laid it out.
export default effect(
  { sparks: 1, glow: 1, seed: 0, smoulder: 0, angle: 0, delay: 0 },
  {
    media: 'optional',
    presence: 'custom',
    bleed: 170,
    animate: {
      fps: ({ element, input }) =>
        input.presence < 1 ? 240 : smouldering.has(element) && !input.reducedMotion ? 30 : 0,
    },
  },
  async (ctx) => {
    const { element, u, place, params, onDispose, signal } = ctx
    const isText = !(element instanceof HTMLImageElement || element instanceof HTMLVideoElement)
    if (isText) {
      await document.fonts.ready
      if (signal.aborted) return
    }
    onDispose(() => smouldering.delete(element))
    const noise = noiseTexture()
    onDispose(() => noise.dispose())

    // Field params are uniforms so switching between leave and enter needs no recompile.
    const edge = uniform(new Vector2(0, 1e5))
    const points = [0, 1, 2].map(() => uniform(new Vector4(0, 0, 0, 0)))
    const climb = uniform(new Vector2(1, 1))
    const shape = uniform(new Vector3(400, 0, 0))
    const front = uniform(-1e5)
    // 0 on leave and at rest (paper is above the front), 1 on enter (paper is below it).
    const mode = uniform(0)
    // Runs past 1, up to 1/BURN, while the sparks die out.
    const burnt = uniform(0)
    const light = uniform(0)
    // Smouldering: the unit direction of the burning side (box px, y up), the projection of
    // that side, how far in the scorch reaches, the fire's strength with the flame's pulse, how
    // much has burnt away in px, and a large offset that puts the fire out.
    const toward = uniform(new Vector2(1, 0))
    const facing = uniform(0)
    const depth = uniform(60)
    const heat = uniform(0)
    const gone = uniform(0)
    const idle = uniform(1e5)
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
      texture(noise, px.div(130).add(vec2(t.mul(0.03), t.mul(-0.12))))
        .a.mul(0.9)
        .add(0.55)

    // Distance in px from the burning front, measured into the paper from the burning side,
    // negative in the last `gone` px, which have burnt away. The front is ragged and slowly
    // breathes a little. Its shape depends only on the position along it, so the distance only
    // grows inwards: one front, no islands.
    const kindle = (px: Node<'vec2'>) => {
      const into = max(facing.sub(px.dot(toward)), 0)
      const along = px.dot(vec2(toward.y.negate(), toward.x))
      const n = texture(noise, vec2(along.div(520).add(t.mul(0.008)), 0.37)).a
      const rag = texture(noise, vec2(along.div(260), 0.71)).a
      const fine = texture(noise, vec2(along.div(320), 0.13)).g
      const edge = gone
        .mul(n.mul(0.3).add(0.85))
        .add(rag.sub(0.5).mul(gone.mul(0.3).add(6)))
        .add(fine.sub(0.5).mul(9))
      return into.sub(edge).add(idle)
    }
    // Paper left of the front: the glowing edge, char with embers in it and toast fading
    // inwards. Past the front nothing but the edge's own glow. `s` scales the
    // bands, `soot` is how dark the paper toasts before it chars. Returns the colour, how much
    // paper is left and the flames' light over the gap.
    const smoulder = (
      rgb: Node<'vec3'>,
      px: Node<'vec2'>,
      s: Node<'float'>,
      soot: Node<'vec3'>,
    ) => {
      const front = kindle(px)
      const k = front
      const vary = texture(noise, px.div(400)).g
      const flick = flicker(px)
      const hot = clamp(k.abs().div(vary.mul(0.8).add(0.6).mul(s, EMBER)).oneMinus(), 0, 1)
      const charEdge = vary.mul(0.7).add(0.65).mul(s, CHAR)
      const toast = fade(charEdge, s.mul(SCORCH), k).pow(1.7)
      // A scorch fading far behind the front.
      const scorch = exp(front.max(0).div(depth.mul(0.6).add(1)).negate()).mul(heat.min(1), 0.55)
      const charred = fade(charEdge.mul(0.55), charEdge, k)
      const specks = smoothstep(0.87, 0.97, texture(noise, px.div(220)).b).mul(
        fade(s.mul(-CHAR * 2), charEdge, k)
          .mul(0.6)
          .add(fade(s.mul(-CHAR * 0.5), charEdge, k).mul(0.4)),
        hot.oneMinus(),
        flick,
      )
      // Char has a grain: fibres and soot of uneven depth.
      const grain = texture(noise, px.div(70))
        .b.mul(0.6)
        .add(texture(noise, px.div(160)).g.mul(0.4))
      const char = CHARRED.mul(grain.mul(1.1).add(0.45))
      let out = rgb.mul(mix(vec3(1), soot, toast.mul(0.92).max(scorch)))
      out = mix(out, char, charred.mul(0.95)).add(ORANGE.mul(specks.mul(0.85)))
      out = mix(
        out,
        ember(hot).mul(flick.mul(0.3).add(0.8), heat.min(1.2)),
        smoothstep(0.08, 0.6, hot),
      )
      const aa = fwidth(front).max(0.3)
      const paper = smoothstep(aa.negate(), aa, front)
      // Past the front only the glowing edge spills a few px; what burnt away is gone.
      const flame = smoothstep(s.mul(-SPILL), 0, front).mul(
        paper.oneMinus(),
        flick.mul(0.75),
        heat.min(1.2),
      )
      const fire = ember(float(0.78))
      return { rgb: out, paper, flame, fire, k, hot, flick }
    }

    // From the paper inwards: toast, char with a few embers, glowing front, then light spilling
    // a few px past the edge. `c` is the paper's colour, `px` the point in box px (y up), `s`
    // scales the bands and `char` is the colour of the char.
    const look = (
      c: Node<'vec4'>,
      px: Node<'vec2'>,
      size: Node<'vec2'>,
      s: Node<'float'> = float(1),
      char: Node<'color'> = CHARRED,
    ) => {
      const { f, vary } = field(px, size)
      const k = side(f)
      const flick = flicker(px)
      const hot = clamp(k.div(vary.mul(0.8).add(0.6).mul(s, EMBER)).oneMinus(), 0, 1)
      const charEdge = vary.mul(0.7).add(0.65).mul(s, CHAR)
      const toast = fade(charEdge, s.mul(SCORCH), k).pow(1.7)
      const charred = fade(charEdge.mul(0.55), charEdge, k)
      const specks = smoothstep(0.8, 0.95, texture(noise, px.div(220)).b).mul(
        fade(s.mul(EMBER), charEdge, k),
        hot.oneMinus(),
        flick,
      )
      let burning = c.rgb.mul(mix(vec3(1), TOAST, toast.mul(0.9)))
      burning = mix(burning, char, charred).add(ORANGE.mul(specks.mul(0.85)))
      burning = mix(burning, ember(hot).mul(flick.mul(0.3).add(0.8)), smoothstep(0.08, 0.6, hot))
      const aa = fwidth(f).max(0.3)
      const paper = smoothstep(aa.negate(), aa, k)
      const spill = smoothstep(s.mul(-SPILL), 0, k).mul(paper.oneMinus(), flick.mul(0.75))
      const left = paper.add(spill)
      burning = burning
        .mul(paper)
        .add(ember(float(0.78)).mul(spill))
        .div(left.max(1e-4))
      // Entering, the picture blooms in warm behind the front.
      const warm = mix(vec3(1), WARM_CAST, fade(0, WARMTH, k).pow(1.5))
      const shown = smoothstep(-SOFT, SOFT * 0.5, k)
      return {
        rgb: mix(burning, c.rgb.mul(warm), mode),
        a: mix(left, shown, mode),
        k,
      }
    }

    // Text is drawn on its own plane, larger than the box, so the glow of its letters isn't cut
    // off at the box's edges.
    let ink: Raster | undefined
    let sheet: Mesh | undefined
    let sheetMap: CanvasTexture | undefined
    const origin = uniform(new Vector2(0, 0))
    const span = uniform(new Vector2(1, 1))
    // Band scale from the font size, and canvas px per CSS px.
    const em = uniform(16)
    const dpr = uniform(1)
    if (isText) {
      ink = raster(element, TEXT_PAD)
      const map = new CanvasTexture(ink.canvas)
      map.colorSpace = SRGBColorSpace
      sheetMap = map
      onDispose(() => sheetMap?.dispose())
      const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
      const at = uv()
      const c = texture(map, at)
      const px = origin.add(at.mul(span))
      // Letters burn like the pictures with the bands scaled to the type. Cream type toasts to a
      // deep brown first, so the char reads against it.
      const s = em.div(24)
      const lit = smoulder(c.rgb, px, s, TEXT_SOOT)
      const base = look(vec4(lit.rgb, c.a), px, u.size, s)
      // The ink blurred by the mipmaps, for a glow that hugs the letters.
      const blurred = (r: Node<'float'>) => {
        const lod = r.mul(dpr).max(1).log2()
        let sum: Node<'float'> = float(0)
        for (const [x, y] of [
          [0.5, 0.5],
          [-0.5, 0.5],
          [0.5, -0.5],
          [-0.5, -0.5],
        ] as const) {
          sum = sum.add(texture(map, at.add(vec2(x, y).mul(r).div(span))).level(lod).a)
        }
        return sum.div(4)
      }
      // The edge's glow spills only off the ink that burns.
      const flames = lit.flame.mul(base.a, c.a)
      const leaving = smoothstep(s.mul(-SPILL * 2.5), 0, base.k).mul(
        fade(0, s.mul(CHAR * 0.9), base.k),
      )
      // Glow around the letters at the front, never inside what burnt away.
      const fronts = leaving.add(lit.hot.mul(heat.min(1.2), smoothstep(s.mul(-SPILL), 0, lit.k)))
      const glow = blurred(s.mul(5))
        .mul(0.6)
        .add(blurred(s.mul(12)).mul(0.4))
        .mul(fronts.mul(1.3), lit.flick)
        .min(1)
      const own = base.a.mul(c.a, lit.paper)
      const light = glow.add(flames).min(1)
      const lightColour = mix(ember(float(0.72)), lit.fire, flames.div(light.max(1e-4)))
      m.colorNode = mix(lightColour, base.rgb, own.div(own.add(light.mul(0.7)).max(1e-4)))
      m.opacityNode = own.add(light.mul(own.oneMinus())).mul(u.opacity)
      sheet = new Mesh(new PlaneGeometry(1, 1), m)
      sheet.frustumCulled = false
      place(sheet, { fit: 'none', replace: true })
    } else {
      ctx.surface.color((c, { box }) => {
        const px = box.mul(u.size)
        const lit = smoulder(c.rgb, px, float(1), TOAST)
        const base = look(vec4(lit.rgb, c.a), px, u.size)
        const own = base.a.mul(c.a, lit.paper)
        const flames = lit.flame.mul(base.a, c.a)
        const a = own.add(flames.mul(own.oneMinus()))
        return vec4(mix(lit.fire, base.rgb, own.div(a.max(1e-4))), a)
      })
    }

    // Firelight on the wall behind the sheet, visible around it and through the holes. Each
    // pixel samples the field at the nearest point of the sheet and falls off with distance.
    // Text has no sheet: its glow hugs the letters instead.
    const room = uniform(new Vector2(1, 1))
    let wall: Mesh | undefined
    if (!isText) {
      const glow = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
      const px = uv().sub(0.5).mul(room).add(u.size.mul(0.5))
      const near = clamp(px, vec2(0, 0), u.size)
      const out = px.sub(near)
      const away = out.length()
      // Five taps along the edge, spread wider with distance. One tap looks like a point light.
      const along = select(out.x.abs().greaterThan(out.y.abs()), vec2(0, 1), vec2(1, 0)).mul(
        away.mul(0.32),
      )
      // A smouldering edge lights the wall next to it too.
      let lit: Node<'float'> = float(0)
      let edges: Node<'float'> = float(0)
      for (const step of [-2, -1, 0, 1, 2]) {
        const at = clamp(near.add(along.mul(step)), vec2(0, 0), u.size)
        const k = side(field(at, u.size, false).f)
        const fall = away.mul(-0.5).sub(14)
        lit = lit.add(exp(k.abs().div(fall)).div(5))
        edges = edges.add(exp(kindle(at).abs().div(fall)).div(5))
      }
      const reach = exp(away.div(-20)).mul(fade(PAD * 0.45, PAD * 0.95, away))
      glow.colorNode = FLAME
      glow.opacityNode = lit
        .mul(light)
        .add(edges.mul(heat.min(1.2), 0.7))
        .mul(reach, flicker(px), 0.55)
      wall = new Mesh(new PlaneGeometry(1, 1), glow)
      wall.position.z = -1
      wall.renderOrder = -1
      wall.frustumCulled = false
      place(wall, { fit: 'none' })
    }

    // Birth times come from the CPU copy of the field, so the shader only computes age.
    const spot = new Float32Array(MAX_SPARKS * 4)
    const flight = new Float32Array(MAX_SPARKS * 4)
    const spotAttr = new InstancedBufferAttribute(spot, 4)
    const flightAttr = new InstancedBufferAttribute(flight, 4)
    const on = uniform(0)
    const born = instancedBufferAttribute<'vec4'>(spotAttr, 'vec4')
    const sparks = sparkSprite(
      born,
      instancedBufferAttribute<'vec4'>(flightAttr, 'vec4'),
      burnt.sub(born.z).div(born.w),
      on,
      u.size,
      46,
    )
    place(sparks, { fit: 'none' })

    // A few embers lift off the burning front, over and over, each on its own cycle
    // (z is the phase, w the life in seconds).
    const emberSpot = new Float32Array(MAX_EMBERS * 4)
    const emberFlight = new Float32Array(MAX_EMBERS * 4)
    const emberSpotAttr = new InstancedBufferAttribute(emberSpot, 4)
    const emberFlightAttr = new InstancedBufferAttribute(emberFlight, 4)
    const glowing = uniform(0)
    const cycle = instancedBufferAttribute<'vec4'>(emberSpotAttr, 'vec4')
    const embers = sparkSprite(
      cycle,
      instancedBufferAttribute<'vec4'>(emberFlightAttr, 'vec4'),
      fract(t.div(cycle.w).add(cycle.z)),
      glowing,
      u.size,
      14,
    )
    place(embers, { fit: 'none' })

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
    // When the smouldering edge starts to burn in, in seconds.
    let kindled: number | undefined
    // What the embers were laid out for: direction, facing side, the burnt width and how many.
    let laid = { x: 0, y: 0, facing: Number.NaN, gone: 0, count: 0 }

    const use = (f: Field, entering: boolean): void => {
      edge.value.set(f.edge[0], f.edge[1])
      for (const [i, p] of f.points.entries()) points[i]?.value.set(p.x, p.y, p.speed, p.delay)
      climb.value.set(f.climb[0], f.climb[1])
      shape.value.set(f.tile, f.amp, f.fine)
      mode.value = entering ? 1 : 0
    }

    const name = (): string =>
      isText ? (element.textContent ?? '') : (element.getAttribute('src') ?? '')

    /** The ink, or the whole box for a picture, in box px (y down). */
    const content = (w: number, h: number) => {
      if (!ink?.lines.length) return { left: 0, right: w, top: 0, bottom: h }
      let top = Number.POSITIVE_INFINITY
      let bottom = Number.NEGATIVE_INFINITY
      for (const l of ink.lines) {
        top = Math.min(top, l.top)
        bottom = Math.max(bottom, l.bottom)
      }
      return { left: ink.left, right: ink.right, top, bottom }
    }

    // Embers start on the ink or paper within reach of the heat, mostly close to the side
    // facing the flame.
    const layEmbers = (count: number): void => {
      const box = content(width, height)
      const random = seeded(hash(`${name()} ${width}x${height} embers`))
      const dx = toward.value.x
      const dy = toward.value.y
      let n = 0
      for (let tries = 0; n < MAX_EMBERS && tries < 600; tries++) {
        const x = box.left + random() * (box.right - box.left)
        const y = height - (box.top + random() * (box.bottom - box.top))
        const into = facing.value - (x * dx + y * dy)
        if (Math.abs(into - gone.value) > gone.value * 0.35 + 6) continue
        emberSpot.set([x, y, random(), 2.6 + random() * 2.6], n * 4)
        const kind = random()
        const small = ink ? 0.7 : 1
        const rise = ink ? 34 + random() * 60 : 50 + random() * 90
        emberFlight.set(
          [
            kind,
            random() * 2 - 1,
            rise,
            small * (kind > 0.8 ? 6 + random() * 3 : 4 + random() * 4),
          ],
          n * 4,
        )
        n++
      }
      emberSpotAttr.needsUpdate = true
      emberFlightAttr.needsUpdate = true
      laid = { x: dx, y: dy, facing: facing.value, gone: gone.value, count: Math.min(n, count) }
    }

    // Turns the burning side to `angle` and sets how much has burnt away, how far the scorch
    // reaches and how hot the front is, hotter while the flame flares. Returns the strength.
    const aim = (flare: number, grown: number): number => {
      const strength = Math.max(0, params.smoulder) * grown
      if (!(strength > 0)) return 0
      const box = content(width, height)
      const angle = (params.angle * Math.PI) / 180
      const dx = Math.cos(angle)
      const dy = Math.sin(angle)
      toward.value.set(dx, dy)
      const corners = [box.left, box.right]
        .flatMap((x) => [height - box.top, height - box.bottom].map((y) => [x, y, x * dx + y * dy]))
        .sort((a, b) => (b[2] ?? 0) - (a[2] ?? 0))
      const hi = corners[0]?.[2] ?? 0
      const lo = corners[3]?.[2] ?? 0
      facing.value = hi
      const share = Math.min(1, strength)
      depth.value = Math.min(160, Math.max(30, (hi - lo) * 0.25)) * share
      gone.value = Math.min(120, Math.max(14, (hi - lo) * 0.17)) * share * (0.94 + 0.06 * flare)
      heat.value = Math.min(1.4, strength * flare)
      return strength
    }

    const measure = (w: number, h: number): void => {
      width = w
      height = h
      seed = params.seed
      if (sheet) {
        const next = raster(element, TEXT_PAD)
        // three uploads a resized canvas into the old GPU texture and crops it, so a new size
        // needs a new texture.
        if (sheetMap) {
          const old = sheetMap.image as HTMLCanvasElement
          if (next.canvas.width !== old.width || next.canvas.height !== old.height) {
            sheetMap.dispose()
          }
          sheetMap.image = next.canvas
          sheetMap.needsUpdate = true
        }
        ink = next
        em.value = Math.min(48, Math.max(10, next.em * 0.9))
        dpr.value = next.canvas.width / next.frame[2]
        const [fx, fy, fw, fh] = next.frame
        origin.value.set(fx, h - (fy + fh))
        span.value.set(fw, fh)
        sheet.scale.set(fw, fh, 1)
        sheet.position.set(fx + fw / 2 - w / 2, h / 2 - (fy + fh / 2), 0)
      }
      const fresh = fields(w, h, hash(`${name()} ${params.seed}`))
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
      room.value.set(w + PAD * 2, h + PAD * 2)
      laid = { x: 0, y: 0, facing: Number.NaN, gone: 0, count: 0 }
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
      const still = input.reducedMotion
      // The flame's flares show on the page a little stronger than on the lantern.
      // On a new page the fire catches at the edge and eats in to its limit, once at rest.
      if (p >= 1 && kindled === undefined) kindled = performance.now() / 1000 + params.delay
      const since = kindled === undefined ? 0 : performance.now() / 1000 - kindled
      const grown = still ? 1 : Math.min(1, Math.max(0, since / GROW))
      const reach = aim(flame(still) ** 2, 1 - (1 - grown) ** 2)
      if (params.smoulder > 0) smouldering.add(element)
      else smouldering.delete(element)
      idle.value = reach > 0 ? 0 : 1e5
      if (reach > 0) {
        const count = Math.round(Math.min(MAX_EMBERS, (ink ? 10 : 14) * reach) * params.sparks)
        const moved =
          Math.abs(toward.value.x - laid.x) + Math.abs(toward.value.y - laid.y) > 0.02 ||
          Math.abs(facing.value - laid.facing) > 4 ||
          Math.abs(gone.value - laid.gone) > Math.max(3, laid.gone * 0.1)
        if (moved || count !== laid.count) layEmbers(count)
      }
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
        mode.value = 0
        front.value = -1e5
        light.value = 0
      }
      if (leaving !== (was === 'leave')) {
        // A burning copy goes on top of the new page so its holes and glow show over the new
        // images. Otherwise the wall light stays underneath.
        const copy = sheet ?? ctx.surface.mesh
        copy.renderOrder = leaving ? 2 : 0
        if (wall) wall.renderOrder = leaving ? 1 : -1
        sparks.renderOrder = leaving ? 3 : 1
        embers.renderOrder = leaving ? 3 : 1
      }
      sparks.count = Math.round(Math.min(MAX_SPARKS, many * Math.max(0, params.sparks)))
      on.value = leaving ? Math.min(1, p / 0.06) : 0
      embers.count = still || leaving ? 0 : laid.count
      glowing.value = Math.min(1, p)
      // Scaled to nothing instead of `visible = false`, so it stays compiled and the first burn
      // doesn't stall on a shader compile.
      if (wall) {
        const shown = light.value > 0 || heat.value > 0
        wall.scale.set(shown ? width + PAD * 2 : 1e-3, shown ? height + PAD * 2 : 1e-3, 1)
      }
    }
  },
)
