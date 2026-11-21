import type { EffectContext } from 'dioramajs'
import { effect } from 'dioramajs'
import {
  abs,
  exp,
  float,
  fract,
  fwidth,
  max,
  mix,
  normalize,
  normalLocal,
  normalView,
  positionLocal,
  positionView,
  pow,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl'
import type { Material, MeshStandardMaterial, Node, Texture } from 'three/webgpu'
import {
  AdditiveBlending,
  Color,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Vector3,
} from 'three/webgpu'
import { flame as flameNow } from './_fire'
import { fibres, flicker, type Member, type Motion, type Twin, twin } from './_lantern'

type Input = EffectContext['input']

/** Cool moonlight from the upper left, in view space. */
const MOON = vec3(0.62, 0.7, 0.95)
const KEY = vec3(-0.42, 0.72, 0.55).normalize()
/** Half widths of a rib and a seam, as fractions of their spacing. */
const RIB = 0.05
const SEAM = 0.03
const GORES = 16

/** Uniforms shared by the lantern's materials. */
interface Lamp {
  readonly tint: Node<'color'>
  /** 0 out, 1 lit, flickering. */
  readonly glow: Node<'float'>
  readonly flame: Node<'vec3'>
  readonly alpha: Node<'float'>
  /** 0 candle orange, 1 the yellower light of a flaring flame. */
  readonly heat: Node<'float'>
}

const facingOf = () => max(normalView.dot(normalize(positionView.negate())), 0)
/** Candle light, linear, more orange than the low sun. */
const FLAME = vec3(1, 0.56, 0.2)
const FLARE = vec3(1, 0.74, 0.36)
/**
 * Flame light after the dyed paper. Dark dyes get a floor, otherwise a wine or indigo lantern
 * looks unlit.
 */
const through = (lamp: Lamp) => {
  const light = pow(lamp.tint, vec3(1.5)).mul(mix(FLAME, FLARE, lamp.heat))
  return light.mul(float(0.66).div(max(max(light.x, max(light.y, light.z)), 0.24)))
}
/** Same light spilling around the lantern, less saturated. */
const spill = (lamp: Lamp) => float(1).sub(exp(through(lamp).mul(-3)))

// Paper lit from inside. Light falls off with distance and angle from the flame and passes more
// where you look straight through. Ribs, print, seams and fibres block some of it. Soft
// saturation takes the core to warm white while the edges keep the paper colour.
function paper(lamp: Lamp, print: Texture | null, ribs: number, radius: number): Material {
  const at = uv()
  const toP = positionLocal.sub(lamp.flame)
  const d2 = toP.dot(toP)
  const reach = max(normalize(normalLocal).dot(normalize(toP)), 0).mul(
    float(radius * radius)
      .div(d2)
      .pow(1.4),
  )
  const facing = facingOf()
  const seen = reach.mul(facing.pow(2.5).mul(1.25).add(0.08))
  const line = (x: Node<'float'>, half: number) => {
    const d = abs(fract(x.add(0.5)).sub(0.5))
    const w = fwidth(x)
    return float(1).sub(smoothstep(float(half).sub(w).max(0), float(half).add(w), d))
  }
  const rib = line(at.y.mul(ribs), RIB)
  const seam = line(at.x.mul(GORES), SEAM)
  // Paper is doubled where it tucks into the caps.
  const tuck = smoothstep(0.07, 0, at.y).add(smoothstep(0.93, 1, at.y))
  // The print is sRGB but read as linear, so its greys fall off steeply. Ink reads as a
  // silhouette and greys as layers of it.
  const clear = print ? texture(print, at).r : float(1)
  const fibre = texture(fibres(), at.mul(vec2(6, 2.2))).r
  const pass = float(1)
    .sub(rib.mul(0.86))
    .mul(clear, float(1).sub(seam.mul(0.14)), float(1).sub(tuck.mul(0.5)))
    .mul(fibre.mul(0.8).add(0.6))
  const light = through(lamp).mul(seen, pass, lamp.glow, 9)
  const lit = float(1).sub(exp(light.negate()))
  // Faint moonlight, all you see before it's lit, and a cool rim.
  const moonlit = lamp.tint.rgb.mul(MOON).mul(max(normalView.dot(KEY), 0).mul(0.05).add(0.02))
  const rim = pow(float(1).sub(facing), 3).mul(0.16)
  const m = new MeshBasicNodeMaterial({ transparent: true })
  m.colorNode = lit.add(moonlit).add(MOON.mul(rim))
  m.opacityNode = lamp.alpha
  return m
}

// Black lacquer with a sharp moon highlight and paper glow on the hoops (v is 0 at the paper).
function lacquer(lamp: Lamp): Material {
  const view = normalize(positionView.negate())
  const half = normalize(KEY.add(view))
  const spec = pow(max(normalView.dot(half), 0), 110).mul(0.75)
  const sheen = pow(max(normalView.dot(half), 0), 12).mul(0.018)
  const rim = pow(float(1).sub(facingOf()), 5).mul(0.08)
  const near = pow(float(1).sub(uv().y), 6)
  const base = vec3(0.022, 0.006, 0.008).mul(normalView.y.mul(0.3).add(0.7))
  const m = new MeshBasicNodeMaterial({ transparent: true })
  m.colorNode = base
    .add(MOON.mul(spec.add(sheen).add(rim)))
    .add(spill(lamp).mul(near, lamp.glow, 0.45))
  m.opacityNode = lamp.alpha
  return m
}

function cord(lamp: Lamp): Material {
  const half = normalize(KEY.add(normalize(positionView.negate())))
  const m = new MeshBasicNodeMaterial({ transparent: true })
  m.colorNode = vec3(0.02, 0.007, 0.008).add(
    MOON.mul(
      pow(float(1).sub(facingOf()), 3)
        .mul(0.22)
        .add(pow(max(normalView.dot(half), 0), 30).mul(0.3)),
    ),
  )
  m.opacityNode = lamp.alpha
  return m
}

// Tassel threads in a deeper shade of the paper, lit from above.
function silk(lamp: Lamp): Material {
  const threads = sin(uv().x.mul(Math.PI * 2 * 34))
    .mul(0.5)
    .add(0.5)
  const above = exp(positionLocal.y.mul(16))
  const dyed = pow(lamp.tint, vec3(1.7))
    .mul(0.75)
    .add(vec3(0.03, 0.004, 0.008))
  const m = new MeshBasicNodeMaterial({ transparent: true })
  m.colorNode = dyed
    .mul(threads.mul(0.3).add(0.7))
    .mul(spill(lamp).mul(above, lamp.glow, 1.2).add(0.14))
    .add(MOON.mul(pow(float(1).sub(facingOf()), 3).mul(0.12)))
  m.opacityNode = lamp.alpha
  return m
}

function halo(lamp: Lamp, strength: Node<'float'>): Mesh {
  const q = uv().sub(0.5).mul(2)
  const r2 = q.dot(q)
  // Tight glow over a wide one, both reaching 0 at the plane's edge.
  const fall = exp(r2.mul(-10))
    .mul(0.55)
    .add(exp(r2.mul(-3)).mul(0.45))
    .sub(Math.exp(-3) * 0.45)
    .max(0)
  const m = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  m.colorNode = spill(lamp)
  m.opacityNode = fall.mul(strength)
  const mesh = new Mesh(new PlaneGeometry(1.5, 1.5), m)
  mesh.renderOrder = -1
  return mesh
}

/** Lantern sizes from the centre to the edge of the light pool. */
const POOL = 2.4

// Firelight on the page behind the lantern: a bright warm core just past the paper, then a wide
// halo falling off like a point light, so the page around is lit too.
function pool(lamp: Lamp, strength: Node<'float'>): Mesh {
  const r = uv()
    .sub(0.5)
    .mul(POOL * 2)
    .length()
  const core = exp(r.div(0.4).pow(2).negate())
  const near = 0.32
  const edge = 1 / (1 + (POOL / near) ** 2)
  const halo = float(1)
    .div(r.div(near).pow(2).add(1))
    .sub(edge)
    .div(1 - edge)
    .max(0)
  const m = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  m.colorNode = spill(lamp)
  m.opacityNode = core.mul(0.55).add(halo.mul(0.3)).mul(strength)
  const mesh = new Mesh(new PlaneGeometry(POOL * 2, POOL * 2), m)
  mesh.renderOrder = -2
  mesh.frustumCulled = false
  return mesh
}

/** Whether an instance still needs frames under reduced motion, e.g. while a tint eases. */
const busy = new WeakMap<Element, () => boolean>()

// A glTF paper lantern fitted to its box like an image. It hangs from the top of the box and
// sways, the pointer brushes it, scroll turns it and `data-dio-tint` dyes the paper. Copies with
// the same `data-dio-key` share one motion, so during a flight the leaving and landing lanterns
// swing in sync. `fire` lets the flame flicker and flare visibly and casts its light on the page
// behind the lantern.
export default effect(
  { src: '', tint: '#e2a18c', glow: 1, sway: 1, turn: 2.4, fire: 0 },
  {
    // The materials read presence themselves so an unpaired lantern goes out before it fades.
    presence: 'custom',
    bleed: 160,
    animate: (ctx) => busy.get(ctx.element)?.() ?? false,
  },
  async ({ app, element, params, place, onDispose, signal, u, input }) => {
    if (!params.src || !app.assets) return
    const asset = app.assets.load(params.src, { type: 'gltf' })
    onDispose(asset)
    const model = await asset.ready
    if (signal.aborted) return

    const lantern = model.instance()
    const info = (lantern.getObjectByName('lantern') ?? lantern).userData as {
      ribs?: number
      radius?: number
      ringTop?: number
      flame?: [number, number, number]
    }
    const ribs = info.ribs ?? 12
    const radius = info.radius ?? 0.235
    const ringTop = info.ringTop ?? 0.39
    const flameAt = new Vector3(...(info.flame ?? [0, -0.07, 0]))

    const tint = uniform(new Color(params.tint))
    const glow = uniform(0)
    const flame = uniform(flameAt.clone())
    const shown = uniform(0)
    const heat = uniform(0)
    const lamp: Lamp = { tint, glow, flame, alpha: u.opacity.mul(shown), heat }
    const haloStrength = uniform(0)
    const poolStrength = uniform(0)

    // The cached materials are shared by every copy, so this one gets its own.
    const mesh = (name: string) => lantern.getObjectByName(name) as Mesh | undefined
    const sheet = mesh('paper')
    const print = (sheet?.material as MeshStandardMaterial | undefined)?.map ?? null
    const dress = (name: string, material: Material) => {
      const m = mesh(name)
      if (m) m.material = material
      else material.dispose()
    }
    dress('paper', paper(lamp, print, ribs, radius))
    dress('caps', lacquer(lamp))
    dress('wire', cord(lamp))
    dress('cord', cord(lamp))
    dress('silk', silk(lamp))
    const tassel = lantern.getObjectByName('tassel')
    const hanger = lantern.getObjectByName('cord')

    // Pivot at the top of the box, the cord stretches up to it.
    const rig = new Group()
    const pivot = new Group()
    const body = new Group()
    const spin = new Group()
    const light = halo(lamp, haloStrength)
    light.position.set(0, 0.03, -0.32)
    spin.add(lantern)
    body.add(light, spin)
    pivot.add(body)
    // On the rig, moved under the body each frame: it follows the swing without tilting.
    const cast = pool(lamp, poolStrength)
    // At the lantern's depth: further back, perspective would pull it towards the screen centre.
    // It draws first and writes no depth, so the lantern still covers it.
    cast.position.z = 0
    cast.visible = params.fire > 0
    rig.add(pivot, cast)
    const centre = new Vector3()
    place(rig, { fit: 'contain', replace: true })

    const me: Member = { element, input }
    const shareOf = twin(element.getAttribute('data-dio-key'), me, params.tint)
    onDispose(shareOf.leave)
    const { motion } = shareOf
    busy.set(element, () => !input.reducedMotion || motion.settling)
    onDispose(() => busy.delete(element))

    return (input, frame) => {
      // The copy in the document drives the shared motion. A detached flight source follows.
      const lead = element.isConnected || ![...shareOf.members].some((m) => m.element.isConnected)
      if (lead && motion.frame !== frame.frame) {
        motion.frame = frame.frame
        step(motion, shareOf, input, Math.min(frame.delta, 1 / 20), params)
      }
      const size = Math.max(1, Math.min(input.width, input.height))
      const top = input.height / 2 / size
      pivot.position.y = top
      body.position.y = -top
      pivot.rotation.set(motion.sway.x, 0, motion.sway.z)
      spin.rotation.y = motion.yaw
      if (tassel) {
        // Tassel swing is in the hanging frame, but the lantern under it is yawed.
        const c = Math.cos(motion.yaw)
        const s = Math.sin(motion.yaw)
        const x = motion.tassel.x - motion.sway.x
        const z = motion.tassel.z - motion.sway.z
        tassel.rotation.set(x * c - z * s, 0, x * s + z * c)
      }
      if (hanger) {
        hanger.visible = top > ringTop + 0.004
        hanger.scale.y = Math.max(0.001, top - ringTop)
      }
      tint.value.copy(motion.tint)
      flame.value.copy(flameAt).add(motion.flameAt)
      // A living flame: brighter and yellower as it flares, and it sits low and wanders, so the
      // hot spot on the paper moves.
      const fire = Math.max(0, params.fire)
      const still = input.reducedMotion
      const pulse = fire > 0 ? flameNow(still) : 1
      const flare = 1 + fire * (pulse - 1) * 1.6
      heat.value = fire * Math.min(1, Math.max(0, (pulse - 0.92) * 3))
      if (fire > 0 && !still) {
        const t = performance.now() / 1000
        flame.value.x += fire * 0.02 * (flicker(t * 1.9 + 41) - 0.5)
        flame.value.y += fire * (0.016 * (pulse - 1) - 0.02)
        flame.value.z += fire * 0.02 * (flicker(t * 1.6 + 73) - 0.5)
      }
      // On first sight the paper comes out of the dark, then the flame catches. Leaving a page
      // alone, the flame goes out first.
      const presence = input.presence
      shown.value = smooth(0, 0.35, motion.lit) * smooth(0, 0.6, presence)
      glow.value =
        smooth(0.08, 1, motion.lit) *
        motion.flame *
        (1 + 0.22 * motion.hover) *
        presence *
        presence *
        params.glow *
        flare
      haloStrength.value = 0.62 * glow.value * shown.value * haloWeight(shareOf, me)
      cast.visible = fire > 0
      if (fire > 0) {
        // The glow stays right behind the lantern's body as it swings.
        rig.updateMatrixWorld()
        body.getWorldPosition(centre)
        rig.worldToLocal(centre)
        cast.position.x = centre.x
        cast.position.y = centre.y
        cast.scale.setScalar(1 + 0.05 * (flare - 1))
        poolStrength.value = fire * glow.value * shown.value * haloWeight(shareOf, me)
      }
    }
  },
)

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * The halo is additive, so a pair in the same pose would double it. The copy in the document
 * only makes up what the leaving copy doesn't show.
 */
function haloWeight(shareOf: Twin, me: Member): number {
  let weight = me.input.opacity
  if (me.element.isConnected) {
    for (const m of shareOf.members) {
      if (m !== me && !m.element.isConnected) weight -= m.input.opacity
    }
  }
  return Math.max(0, weight)
}

/** Seconds to light up on first sight. */
const LIGHT_UP = 1.6
/** Swing and tassel angular frequencies, 4.8 s and 1.5 s periods. */
const SWING = (2 * Math.PI) / 4.8
const TASSEL = (2 * Math.PI) / 1.5
/** Rest yaw. A lantern reads rounder in three quarter view. */
const REST = -0.32

interface Params {
  readonly tint: string
  readonly sway: number
  readonly turn: number
}

function step(m: Motion, shareOf: Twin, input: Input, dt: number, params: Params): void {
  const still = input.reducedMotion
  const ease = (rate: number) => (still ? 1 : 1 - Math.exp(-dt * rate))
  if (params.tint !== m.css) {
    m.css = params.tint
    m.goal.set(params.tint)
  }
  m.tint.lerp(m.goal, ease(5))
  m.hover = input.hover
  m.lit = still ? 1 : Math.min(1, m.lit + dt / LIGHT_UP)
  if (!still) m.t += dt
  const t = m.t
  // Uneven while catching, then a slow breath and a quick flutter.
  const catching = (1 - m.lit) * 0.5
  m.flame = still
    ? 1
    : 1 +
      (0.07 + catching) * (flicker(t * 7) - 0.5) +
      0.04 * Math.sin(t * 2.1) * Math.sin(t * 0.7 + 1)
  // The flame wanders a little so the hot spot on the paper moves.
  if (still) m.flameAt.set(0, 0, 0)
  else
    m.flameAt.set(0.006 * (flicker(t * 2.3 + 11) - 0.5), 0.008 * (flicker(t * 1.7 + 27) - 0.5), 0)

  // Track the box that's on screen, which is the flying copy during a flight.
  let source = input
  for (const member of shareOf.members) if (!member.element.isConnected) source = member.input
  const size = Math.max(1, Math.min(source.width, source.height))
  const cx = source.x + source.width / 2
  const vx = m.cx === undefined || dt <= 0 ? 0 : (cx - m.cx) / dt
  const v = m.vx + (vx - m.vx) * (1 - Math.exp(-dt / 0.06))
  const accel =
    dt > 0 && m.cx !== undefined ? Math.max(-40, Math.min(40, (v - m.vx) / dt / size)) : 0
  m.cx = cx
  m.vx = v

  // Pointer speed near the lantern pushes the swing.
  let push = 0
  const p = input.pointerWorld
  const centre = { x: cx - innerWidth / 2, y: innerHeight / 2 - (source.y + source.height / 2) }
  if (m.pointer && dt > 0) {
    const pvx = Math.max(-4000, Math.min(4000, (p.x - m.pointer.x) / dt))
    const near = Math.max(0, 1 - Math.hypot(p.x - centre.x, p.y - centre.y) / (0.5 * size))
    push = (pvx / size) * near * near * 0.45
  }
  m.pointer = { x: p.x, y: p.y }

  const s = m.sway
  if (still) {
    s.x = s.z = s.vx = s.vz = 0
    m.tassel.x = m.tassel.z = m.tassel.vx = m.tassel.vz = 0
  } else if (dt > 0) {
    const breeze = 0.05 * params.sway
    const bz =
      breeze *
      (Math.sin(0.31 * t + 0.7) + 0.55 * Math.sin(0.83 * t + 2.1) + 0.3 * Math.sin(1.37 * t))
    const bx = breeze * 0.6 * (Math.sin(0.27 * t + 2.4) + 0.5 * Math.sin(0.71 * t))
    const k = SWING * SWING
    const vz0 = s.vz
    const vx0 = s.vx
    s.vz += (-k * s.z - 0.55 * s.vz + bz + push - accel * 0.025) * dt
    s.vx += (-k * s.x - 0.55 * s.vx + bx) * dt
    s.z = Math.max(-0.3, Math.min(0.3, s.z + s.vz * dt))
    s.x = Math.max(-0.2, Math.min(0.2, s.x + s.vx * dt))
    // The tassel is a pendulum driven by the acceleration of the lantern's foot (over g), so it
    // lags behind and settles faster.
    const a = m.tassel
    const kt = TASSEL * TASSEL
    a.vz += (-kt * (a.z + ((s.vz - vz0) / dt / k) * 0.6 + accel * 0.012) - 2.2 * a.vz) * dt
    a.vx += (-kt * (a.x + ((s.vx - vx0) / dt / k) * 0.6) - 2.2 * a.vx) * dt
    a.z = Math.max(-0.5, Math.min(0.5, a.z + a.vz * dt))
    a.x = Math.max(-0.5, Math.min(0.5, a.x + a.vx * dt))
  }

  // Scroll turns it, and it leans a little towards the pointer.
  const toward = still
    ? 0
    : Math.max(-1, Math.min(1, (p.x - centre.x) / Math.max(400, innerWidth * 0.5))) * 0.35
  const goal = REST + (still ? 0 : (input.progress - 0.5) * params.turn) + toward
  m.yaw = Number.isNaN(m.yaw) ? goal : m.yaw + (goal - m.yaw) * ease(3)
  const dyeing =
    Math.abs(m.tint.r - m.goal.r) + Math.abs(m.tint.g - m.goal.g) + Math.abs(m.tint.b - m.goal.b)
  m.settling = m.lit < 1 || Math.abs(goal - m.yaw) > 1e-3 || dyeing > 1e-3
}
