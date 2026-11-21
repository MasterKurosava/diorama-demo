import { effect, oneOf } from 'dioramajs'
import {
  abs,
  clamp,
  color,
  cos,
  dot,
  exp,
  faceDirection,
  float,
  fwidth,
  instancedDynamicBufferAttribute,
  max,
  mix,
  normalize,
  positionGeometry,
  select,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node } from 'three/webgpu'
import {
  CanvasTexture,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Vector4,
} from 'three/webgpu'
import { marks, paint, type Strip, strips } from './_fold'
import { D } from './_hero'
import { grainAt, WARM } from './_look'

/** Panel angle when fully folded, radians. */
const THETA = 1.08
/** Sun direction: up, right and out of the wall. */
const SUN = [0.62, 0.42, 0.66].map((v, _, a) => v / Math.hypot(...a)) as [number, number, number]
/** A strip unfolds while its middle moves between these fractions of the viewport height. */
const FROM = 1
const TO = 0.58
/** Part of the unfold spent sweeping open from the fixed point to the far end. */
const SWEEP = 0.55
/** Crease lift under the pointer, radians. */
const TOUCH = 0.26
/** Seconds to fold up after the copy takes over from the flat page text. */
const INTRO = 1.2
/** Wall light bounced into the paper's shade. */
const SHADE = [0.36, 0.2, 0.25] as const
/** Highlighter colour for the page selection. */
const MARKER = color('#e2a18c')

const moving = new WeakSet<Element>()
const smoother = (x: number): number => x * x * x * (x * (x * 6 - 15) + 10)
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

// Text printed on accordion-folded paper strips that unfold flat as the text scrolls up. Each
// line (or word, for display text) is a strip. At rest it lies exactly where the browser set the
// text, with faint old creases. The real text stays in the DOM for selection, search and screen
// readers, and the strips mirror its selection.
export default effect(
  { by: oneOf('line', 'word'), folds: 10, paper: '#f3e9d8', ink: '#4b1519', pad: [0.32, 0.06] },
  { rebuild: ['folds', 'pad'], bleed: 240, animate: ({ element }) => moving.has(element) },
  async ({ element, params, u, place, render, signal, invalidate }) => {
    await document.fonts.ready
    if (signal.aborted) return
    const host = element as HTMLElement
    const by = params.by
    const folds = Math.max(1, Math.round(params.folds))
    const text = host.textContent ?? ''
    const words = Math.max(1, text.match(/\S+/g)?.length ?? 0)
    // Upper bound on panels: `folds` per line, or one per letter in word mode.
    const capacity =
      by === 'line' ? words * Math.max(2, folds) : Math.max(1, text.replace(/\s/g, '').length)

    const buffer = (count: number) => {
      const attr = new InstancedBufferAttribute(new Float32Array(count * 4), 4)
      const node = instancedDynamicBufferAttribute<'vec4'>(attr, 'vec4')
      return { array: attr.array as Float32Array, attr, node }
    }
    // Per panel. `box` is the strip's rect, `cell` is start, width, fixed point and fold side,
    // `ends` marks crease ends. `fold` and `pose` are rewritten every frame.
    const box = buffer(capacity)
    const cell = buffer(capacity)
    const ends = buffer(capacity)
    const fold = buffer(capacity)
    const pose = buffer(capacity)
    // Per strip, for the wall shadow.
    const shade = buffer(words)
    const blur = buffer(words)

    const inkCanvas = document.createElement('canvas')
    const markCanvas = document.createElement('canvas')
    const ink = new CanvasTexture(inkCanvas)
    const mark = new CanvasTexture(markCanvas)
    ink.anisotropy = 8
    const inkAt = uniform(new Vector4(0, 0, 1, 1))
    const sun = vec3(...SUN)
    const t = positionGeometry.x.add(0.5)
    const v = positionGeometry.y.add(0.5)
    const s = box.node
    const c = cell.node
    const f = fold.node
    const p = pose.node
    const along = t.mul(c.y)
    // Strip pose: lean back about the long axis, then a slight roll in the wall plane.
    const turn = (q: Node<'vec3'>): Node<'vec3'> => {
      const a = vec3(
        q.x,
        q.y.mul(cos(p.y)).sub(q.z.mul(sin(p.y))),
        q.y.mul(sin(p.y)).add(q.z.mul(cos(p.y))),
      )
      return vec3(
        a.x.mul(cos(p.z)).sub(a.y.mul(sin(p.z))),
        a.x.mul(sin(p.z)).add(a.y.mul(cos(p.z))),
        a.z,
      )
    }
    // A panel runs from its start crease at its own angle, relative to the strip's fixed point.
    // The element's centre is the origin.
    const local = turn(
      vec3(
        f.x.add(along.mul(cos(f.z))).sub(c.z),
        v.sub(0.5).mul(s.w),
        f.y.add(along.mul(sin(f.z))),
      ),
    )
    const paper = new MeshBasicNodeMaterial({ transparent: true, side: DoubleSide })
    paper.positionNode = vec3(
      s.x.add(c.z).add(local.x).sub(u.size.x.mul(0.5)),
      u.size.y.mul(0.5).sub(s.y).sub(s.w.mul(0.5)).add(local.y).add(p.w),
      local.z.add(p.x),
    )
    const normal = varying(turn(vec3(sin(f.z).negate(), 0, cos(f.z))))
    // Flat position in px from the element's top left.
    const flat = varying(vec2(s.x.add(c.x).add(along), s.y.add(v.oneMinus().mul(s.w))))
    const across = varying(t)
    const up = varying(v)

    const side = c.w
    const open = sin(f.w)
    const rest = open.oneMinus()
    // 1 when flat. The side turned away darkens fast, the sunny side brightens a little.
    const facing = dot(normalize(normal).mul(faceDirection), sun).sub(SUN[2])
    const lit = facing.mul(select(facing.lessThan(0), float(1.25), float(0.5))).add(1)
    const out = side.greaterThan(0)
    const fromLeft = across.mul(c.y)
    const fromRight = across.oneMinus().mul(c.y)
    const valley = select(out, fromLeft, fromRight)
    const ridge = select(out, fromRight, fromLeft)
    const isValley = select(out, ends.node.x, ends.node.y)
    const isRidge = select(out, ends.node.y, ends.node.x)
    const upper = up.oneMinus().mul(s.w)
    const lower = up.mul(s.w)
    const hair = (d: Node<'float'>): Node<'float'> => smoothstep(fwidth(d).mul(1.25), float(0), d)
    // Old folds stay visible when flat, with alternate panels a shade apart and a hairline at
    // each crease. When folded, valleys self-shade and ridges catch light.
    const memory = side
      .mul(-0.02)
      .mul(rest)
      .sub(isValley.mul(exp(valley.div(-7)), 0.05))
      .add(isRidge.mul(exp(ridge.div(-5)), 0.035))
    const hollow = isValley.mul(exp(valley.div(c.y.mul(-0.22))), open, 0.45)
    const crease = isValley
      .mul(hair(valley), open.mul(0.12).add(0.1))
      .sub(isRidge.mul(hair(ridge), open.mul(0.3).add(0.07)))
    // Paper thickness. Top edge catches the sun, bottom edge is in shade.
    const edges = hair(upper).mul(0.07).sub(hair(lower).mul(0.12))
    const light = lit.mul(float(1).sub(hollow)).add(memory).sub(crease).add(edges)
    const tint = mix(vec3(...SHADE), vec3(1, 1, 1), clamp(light, 0, 1))
    const glow = WARM.mul(max(light.sub(1), 0).mul(0.8))
    const inkUV = vec2(
      flat.x.add(inkAt.x).div(inkAt.z),
      float(1).sub(flat.y.add(inkAt.y).div(inkAt.w)),
    )
    const front = step(0, faceDirection)
    const marked = texture(mark, inkUV).a.mul(front)
    const printed = texture(ink, inkUV).a.mul(front)
    const stock = mix(u.paper, MARKER, marked.mul(0.85)).mul(grainAt(flat, vec2(1, 1)))
    const page = stock.mul(tint).add(glow)
    paper.colorNode = vec4(mix(page, tint.mul(u.ink), printed), 1)
    paper.opacityNode = u.opacity
    const sheet = new Mesh(new PlaneGeometry(1, 1), paper)
    sheet.frustumCulled = false
    sheet.renderOrder = 1

    // Wall shadow gets softer, further and fainter the higher the paper stands.
    const sh = shade.node
    const sb = blur.node
    const q = positionGeometry.xy.mul(sh.zw.add(sb.x.mul(2)).mul(2))
    const shadow = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
    shadow.positionNode = vec3(sh.xy.add(q), 0)
    const qa = abs(varying(q))
    const soft = smoothstep(sb.x.negate(), sb.x, sh.z.sub(qa.x)).mul(
      smoothstep(sb.x.negate(), sb.x, sh.w.sub(qa.y)),
    )
    shadow.colorNode = vec4(0.03, 0.004, 0.01, 1)
    shadow.opacityNode = soft.mul(sb.y, u.opacity)
    const shadows = new Mesh(new PlaneGeometry(1, 1), shadow)
    shadows.frustumCulled = false
    shadows.renderOrder = 0

    const group = new Group()
    group.add(shadows, sheet)
    place(group, { fit: 'none', replace: true })

    let list: Strip[] = []
    /** `far` is the distance from the strip's fixed point, 0..1. */
    let panels: { strip: number; start: number; width: number; side: number; far: number }[] = []
    /** Index of each strip's first panel, plus the end. */
    let first: number[] = []
    let scale = 1
    const remark = (): void => {
      const was = [markCanvas.width, markCanvas.height]
      marks(host, markCanvas, scale)
      if (was[0] !== markCanvas.width || was[1] !== markCanvas.height) mark.dispose()
      mark.needsUpdate = true
      invalidate()
    }
    const relayout = (): void => {
      list = strips(host, by, folds, params.pad)
      panels = []
      first = []
      for (const [i, strip] of list.entries()) {
        first.push(panels.length)
        const edges = [0, ...strip.creases, strip.width]
        const fixed = strip.anchor * strip.width
        const reach = Math.max(fixed, strip.width - fixed, 1)
        for (let j = 0; j + 1 < edges.length && panels.length < capacity; j++) {
          const a = edges[j] as number
          const b = edges[j + 1] as number
          const far = Math.abs((a + b) / 2 - fixed) / reach
          panels.push({ strip: i, start: a, width: b - a, side: j % 2 ? -1 : 1, far })
        }
      }
      first.push(panels.length)
      for (const [k, pn] of panels.entries()) {
        const strip = list[pn.strip] as Strip
        const last = k + 1 === first[pn.strip + 1]
        box.array.set([strip.left, strip.top, strip.width, strip.height], k * 4)
        cell.array.set([pn.start, pn.width, strip.anchor * strip.width, pn.side], k * 4)
        ends.array.set([pn.start > 0 ? 1 : 0, last ? 0 : 1, 0, 0], k * 4)
      }
      for (const b of [box, cell, ends]) b.attr.needsUpdate = true
      sheet.count = panels.length
      shadows.count = list.length

      scale = render.renderer.getPixelRatio()
      const was = [inkCanvas.width, inkCanvas.height]
      const where = paint(host, inkCanvas, scale)
      // three copies a resized canvas into the old GPU texture, cropped, so drop it first.
      if (was[0] !== inkCanvas.width || was[1] !== inkCanvas.height) ink.dispose()
      ink.needsUpdate = true
      inkAt.value.set(where.x, where.y, where.width, where.height)
      remark()
      // A new layout jumps straight to the scroll position, no easing.
      const key = list.map((r) => `${r.left},${r.top},${r.width},${r.height}`).join(';')
      if (key !== laid) done = []
      laid = key
      invalidate()
    }

    /** Unfold per strip, 0..1, eased towards the scroll target. */
    let done: number[] = []
    /**
     * Seconds since the copy took over from the flat page text. Visible strips start flat too
     * and ease into place, so there's no jump.
     */
    let age = -1
    let handed: boolean[] = []
    let laid = ''
    let selected = false
    relayout()
    const resize = new ResizeObserver(relayout)
    resize.observe(host)
    document.fonts.addEventListener('loadingdone', relayout, { signal })
    // Keep the paper still while a button is down, the user may be selecting text.
    let pressed = false
    const press = (e: PointerEvent): void => {
      pressed = e.type === 'pointerdown'
    }
    document.addEventListener('pointerdown', press, { signal })
    document.addEventListener('pointerup', press, { signal })
    document.addEventListener('pointercancel', press, { signal })
    document.addEventListener(
      'selectionchange',
      () => {
        const sel = getSelection()
        const here =
          !!sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.getRangeAt(0).intersectsNode(host)
        // Repaint while the selection touches the element, and once more as it leaves.
        if (here || selected) remark()
        selected = here
      },
      { signal },
    )
    signal.addEventListener('abort', () => {
      resize.disconnect()
      ink.dispose()
      mark.dispose()
      moving.delete(element)
    })

    return (input) => {
      const vh = window.innerHeight
      const top = vh - input.progress * (vh + input.height)
      const ease = 1 - Math.exp(-input.delta * 6)
      if (done.length !== list.length) {
        done = list.map(() => (age < 0 ? 1 : -1))
        handed = list.map(() => age < 0)
      }
      age = age < 0 ? 0 : age + input.delta
      const intro = age < INTRO ? 1 - smoother(age / INTRO) : 0
      let busy = intro > 0
      // Creases near the pointer rise a little.
      const touch = pressed ? 0 : input.hover
      const pointerX = input.pointer.x * input.width
      const pointerY = (1 - input.pointer.y) * input.height
      if (touch > 0.001 && touch < 0.999) busy = true
      for (const [i, strip] of list.entries()) {
        const middle = top + strip.top + strip.height / 2
        const goal = input.reducedMotion
          ? 1
          : clamp01((FROM * vh - middle) / ((FROM - TO) * vh) - strip.order * 0.07)
        const was = done[i] as number
        // Off screen there's nothing to ease.
        const seen = middle + strip.height > -100 && middle - strip.height < vh + 100
        if (was < 0 || !seen) handed[i] = false
        let d =
          was < 0 || !seen
            ? goal
            : handed[i] && intro > 0
              ? goal + (1 - goal) * intro
              : was + (goal - was) * ease
        if (Math.abs(goal - d) < 1e-4) d = goal
        else busy = true
        done[i] = d
        const folded = 1 - smoother(d)
        const aside = (pointerY - strip.top - strip.height / 2) / strip.height
        const near = touch > 0.001 ? touch * Math.exp(-aside * aside * 1.5) * (1 - folded) : 0
        const from = first[i] as number
        const to = first[i + 1] as number
        const fixed = strip.anchor * strip.width
        // A folded strip yaws towards the eye so both sides of each pleat show anywhere on
        // screen. Around the vertical axis that just adds to each panel's angle.
        const centre = input.x + strip.left + strip.width / 2 - window.innerWidth / 2
        const yaw = Math.atan(centre / D) * (1 - smoother(clamp01(d * 1.3)))
        let x = 0
        let z = 0
        let low = 0
        let sumZ = 0
        let fixedX = 0
        for (let k = from; k < to; k++) {
          const pn = panels[k] as (typeof panels)[number]
          const reach = near > 0 ? (pointerX - strip.left - pn.start - pn.width / 2) / 150 : 0
          const theta =
            THETA * (1 - smoother(clamp01(d * (1 + SWEEP) - SWEEP * pn.far))) +
            TOUCH * near * Math.exp(-reach * reach)
          // Never past edge-on, or a pleat folds back over its neighbour.
          const phi = Math.min(1.45, Math.max(-1.45, pn.side * theta + yaw))
          fold.array.set([x, z, phi, theta], k * 4)
          if (fixed >= pn.start && fixed <= pn.start + pn.width) {
            fixedX = x + (fixed - pn.start) * Math.cos(phi)
          }
          x += pn.width * Math.cos(phi)
          z += pn.width * Math.sin(phi)
          low = Math.min(low, z)
          sumZ += z
        }
        // Keep the fixed point in place and rest the paper on the wall at its lowest crease.
        const dx = fixed - fixedX
        for (let k = from; k < to; k++) {
          fold.array[k * 4] = (fold.array[k * 4] as number) + dx
          fold.array[k * 4 + 1] = (fold.array[k * 4 + 1] as number) - low
        }
        const lift = 30 * folded
        const roll = ((strip.line + strip.order) % 2 ? 0.035 : -0.035) * folded
        const rise = -22 * folded
        for (let k = from; k < to; k++) pose.array.set([lift, -0.24 * folded, roll, rise], k * 4)

        // Shadow is the strip's footprint pushed away from the sun by its height.
        const height = (to > from ? sumZ / (to - from) - low : 0) + lift
        const off = height * 0.8 + 1.6
        const minX = Math.min(dx, x + dx)
        const w = Math.abs(x)
        shade.array.set(
          [
            strip.left + minX + w / 2 - input.width / 2 - off * (SUN[0] / SUN[2]),
            input.height / 2 - strip.top - strip.height / 2 + rise - off * (SUN[1] / SUN[2]),
            w / 2,
            strip.height / 2,
          ],
          i * 4,
        )
        blur.array.set([2.2 + height * 0.36, 0.72 - 0.3 * Math.min(1, height / 120), 0, 0], i * 4)
      }
      for (const b of [fold, pose, shade, blur]) b.attr.needsUpdate = true
      if (busy) moving.add(element)
      else moving.delete(element)
    }
  },
)
