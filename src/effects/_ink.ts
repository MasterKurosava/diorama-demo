// Wet paper for the ink effect. The spread is computed on the CPU as a shortest-path flood from
// each drop through the uneven fibres, and the shader only samples the result. No noise or loops
// on the GPU.
//
// Two layers. The spreading one holds arrival time and depth inside a bloom, the dry one holds
// depth inside the dried wash. Once every drop has dried, the spreading layer is folded into the
// dry one, so new drops never disturb old edges.
import type { EffectContext } from 'dioramajs'
import { color, exp, float, max, mix, smoothstep, step, texture, uniform } from 'three/tsl'
import type { Node } from 'three/webgpu'
import {
  CanvasTexture,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
} from 'three/webgpu'
import { lightOf } from './_look'

const PAPER = color('#f3e9d8')
const COLUMNS = 160
/** Cells past a wash edge that still store distance, so the edge interpolates smoothly. */
const MARGIN = 4
/** Radius grows as time ** (1 / CREEP), fast at first and slower as the ink soaks in. */
const CREEP = 1.7
/** Seconds the damp paper ahead of the ink takes to dry once the ink has stopped. */
const DAMP = 1.4
/** The sheet's own drops, in box uv with y up. */
const SEEDS = [
  { x: 0.56, y: 0.6, at: 0.25, reach: 0.42, last: 3.4 },
  { x: 0.46, y: 0.24, at: 0.8, reach: 0.44, last: 3.6 },
  { x: 0.16, y: 0.34, at: 1.4, reach: 0.26, last: 2.8 },
  { x: 0.82, y: 0.82, at: 1.9, reach: 0.32, last: 3 },
  { x: 0.24, y: 0.8, at: 2.4, reach: 0.28, last: 2.8 },
] as const
/** Pointer drops. `reach` is a fraction of the sheet width, `spacing` a fraction of reach. */
const DROP = { reach: 0.13, last: 1.3, spacing: 0.38 } as const
/** The 8 adjacent cells plus 8 knight moves, which make flood fronts rounder. */
const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [2, 1],
  [2, -1],
  [-2, 1],
  [-2, -1],
  [1, 2],
  [1, -2],
  [-1, 2],
  [-1, -2],
].map(([x = 0, y = 0]) => ({ x, y, length: Math.hypot(x, y) }))

/** Seeded so the fibres stay the same between visits. */
function seeded(seed: number): () => number {
  let a = seed * 2654435761
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Smooth value noise in 0..1, `cells` lattice cells across. Tiles when `wrap` is set. */
function noise(
  w: number,
  h: number,
  cells: number,
  random: () => number,
  wrap = false,
): Float32Array {
  const lw = cells + 2
  const lh = Math.ceil((cells * h) / w) + 2
  const lattice = Float32Array.from({ length: lw * lh }, random)
  const rows = Math.round((cells * h) / w)
  const at = (a: number, b: number) =>
    lattice[(wrap ? b % rows : b) * lw + (wrap ? a % cells : a)] ?? 0
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x / w) * cells
      const v = (y / w) * cells
      const i = Math.floor(u)
      const j = Math.floor(v)
      const su = (u - i) ** 2 * (3 - 2 * (u - i))
      const sv = (v - j) ** 2 * (3 - 2 * (v - j))
      const top = at(i, j) + (at(i + 1, j) - at(i, j)) * su
      const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * su
      out[y * w + x] = top + (bottom - top) * sv
    }
  }
  return out
}

const ramp = (a: number, b: number, x: number) => Math.min(1, Math.max(0, (x - a) / (b - a)))
/** Smooth max, so blooms that meet flow together with rounded inner corners. */
function merge(a: number, b: number, k = 4): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.max(a, b) + h * h * k * 0.25
}

/**
 * Tiling paper texture, one texel per CSS pixel, painted once and shared by every sheet. R holds
 * fibres the ink edge runs along and G a fine speckle the pigment settles into, both centred on
 * 0.5. B is the tide line strength, so the lines come and go along an edge.
 */
let surface: HTMLCanvasElement | undefined
function fibres(): CanvasTexture {
  surface ??= paintSurface()
  const map = new CanvasTexture(surface)
  map.colorSpace = NoColorSpace
  map.wrapS = map.wrapT = RepeatWrapping
  return map
}
function paintSurface(): HTMLCanvasElement {
  const side = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = side
  const g = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  g.fillStyle = 'rgb(128 128 128)'
  g.fillRect(0, 0, side, side)
  const random = seeded(5)
  g.lineCap = 'round'
  for (let i = 0; i < 2600; i++) {
    const x = random() * side
    const y = random() * side
    const angle = random() * Math.PI
    const length = 4 + random() ** 2 * 30
    const bend = (random() - 0.5) * 0.5
    const dx = Math.cos(angle) * length
    const dy = Math.sin(angle) * length
    const alpha = 0.12 + random() * 0.3
    g.strokeStyle = random() < 0.5 ? `rgb(255 255 255 / ${alpha})` : `rgb(0 0 0 / ${alpha * 0.8})`
    g.lineWidth = 0.5 + random() * 1.1
    // Repeat strokes that cross an edge on the opposite side so the tile has no seam.
    const pad = length * 0.3 + 2
    const near = (at: number, d: number) => [
      0,
      ...(at + Math.min(0, d) - pad < 0 ? [side] : []),
      ...(at + Math.max(0, d) + pad > side ? [-side] : []),
    ]
    const [xs, ys] = [near(x, dx), near(y, dy)]
    for (const ox of xs) {
      for (const oy of ys) {
        g.beginPath()
        g.moveTo(x + ox, y + oy)
        g.quadraticCurveTo(
          x + ox + dx / 2 - dy * bend,
          y + oy + dy / 2 + dx * bend,
          x + ox + dx,
          y + oy + dy,
        )
        g.stroke()
      }
    }
  }
  const image = g.getImageData(0, 0, side, side)
  const raw = Float32Array.from({ length: side * side }, random)
  const at = (x: number, y: number) => raw[((y + side) % side) * side + ((x + side) % side)] ?? 0
  const lines = noise(side, side, 5, seeded(13), true)
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const v = (at(x, y) * 4 + at(x + 1, y) + at(x - 1, y) + at(x, y + 1) + at(x, y - 1)) / 8
      const o = (y * side + x) * 4
      image.data[o + 1] = Math.round(128 + (v - 0.5) * 300)
      image.data[o + 2] = Math.round(255 * (0.2 + 0.8 * ramp(0.25, 0.7, lines[y * side + x] ?? 0)))
    }
  }
  g.putImageData(image, 0, 0)
  return canvas
}

/** Min-heap of cells by distance. Typed arrays, since a flood pushes thousands. */
class Heap {
  keys = new Float32Array(1024)
  cells = new Int32Array(1024)
  size = 0
  /** Distance of the cell `pop` returned last. */
  key = 0
  push(key: number, cell: number): void {
    if (this.size === this.keys.length) {
      const keys = new Float32Array(this.size * 2)
      const cells = new Int32Array(this.size * 2)
      keys.set(this.keys)
      cells.set(this.cells)
      this.keys = keys
      this.cells = cells
    }
    let i = this.size++
    while (i > 0) {
      const parent = (i - 1) >> 1
      if ((this.keys[parent] ?? 0) <= key) break
      this.keys[i] = this.keys[parent] ?? 0
      this.cells[i] = this.cells[parent] ?? 0
      i = parent
    }
    this.keys[i] = key
    this.cells[i] = cell
  }
  pop(): number {
    const top = this.cells[0] ?? 0
    this.key = this.keys[0] ?? 0
    const key = this.keys[--this.size] ?? 0
    const cell = this.cells[this.size] ?? 0
    let i = 0
    for (;;) {
      let child = 2 * i + 1
      if (child >= this.size) break
      if (child + 1 < this.size && (this.keys[child + 1] ?? 0) < (this.keys[child] ?? 0)) child++
      if ((this.keys[child] ?? 0) >= key) break
      this.keys[i] = this.keys[child] ?? 0
      this.cells[i] = this.cells[child] ?? 0
      i = child
    }
    this.keys[i] = key
    this.cells[i] = cell
    return top
  }
}

/** One per element. It outlives effect rebuilds, so a new version keeps the ink. */
class Sheet {
  readonly w: number
  readonly h: number
  /** Arrival time of the spreading ink, in ink seconds. Infinity where none spreads. */
  readonly time: Float32Array
  /** Depth inside a spreading bloom, in cells, negative outside. */
  readonly wet: Float32Array
  /** Depth inside the dried wash. */
  readonly dry: Float32Array
  /** Wash edge as it stood when the cell dried. Tide lines sit near 0. */
  readonly mark: Float32Array
  /** Cost of crossing each cell, from the uneven fibres. */
  readonly cost: Float32Array
  readonly #reach: Float32Array
  readonly #heap = new Heap()
  readonly #data: Uint16Array
  readonly map: DataTexture
  readonly fibres = fibres()
  readonly now = uniform(0)
  readonly random = seeded(11)
  /** Ink seconds since wetting, and the clock value the texture stores times relative to. */
  clock = 0
  epoch = 0
  /** `until` is when the last spreading drop stops, in ink seconds. */
  spreading = false
  until = 0
  /** Drying time after the ink stops. Wetter ink (larger `spread`) takes longer. */
  settle = DAMP
  /** Last clock step. At speed 0 no frames are needed. */
  step = 1
  reduced = false
  #dirty: [number, number, number, number] | undefined
  #rebase = true
  users = 0
  invalidate: () => void = () => {}
  last: { x: number; y: number } | undefined
  bye: ReturnType<typeof setTimeout> | undefined

  constructor(aspect: number) {
    this.w = COLUMNS
    this.h = Math.round(COLUMNS * Math.min(2, Math.max(0.5, aspect)))
    const n = this.w * this.h
    this.time = new Float32Array(n)
    this.wet = new Float32Array(n)
    this.dry = new Float32Array(n)
    this.mark = new Float32Array(n)
    this.#reach = new Float32Array(n).fill(Infinity)
    this.#data = new Uint16Array(n * 4)
    // Unevenness at three scales: broad patches the ink skirts, lobes on its fronts, a grain.
    const broad = noise(this.w, this.h, 4, seeded(3))
    const lobes = noise(this.w, this.h, 11, seeded(7))
    const grain = noise(this.w, this.h, 37, seeded(9))
    this.cost = broad.map(
      (b, i) =>
        0.5 + 1.1 * b ** 3 + 1.5 * ramp(0.4, 0.8, lobes[i] ?? 0) ** 2 + 0.8 * (grain[i] ?? 0),
    )
    this.map = new DataTexture(this.#data, this.w, this.h, RGBAFormat, HalfFloatType)
    this.map.magFilter = this.map.minFilter = LinearFilter
    this.clear()
  }

  clear(): void {
    this.time.fill(Infinity)
    this.wet.fill(-MARGIN)
    this.dry.fill(-MARGIN)
    this.mark.fill(-MARGIN)
    this.clock = this.until = 0
    this.spreading = false
    this.last = undefined
    this.#rebase = true
  }

  seed(): void {
    for (const s of SEEDS) this.drop(s.x, s.y, s.at, s.reach * this.w, s.last)
  }

  /**
   * Drops ink at box uv (x, y) at ink time `at`. It floods along the cheapest paths until it has
   * spent `reach` cells, and timing is computed a bit further so meeting blooms blend by earliest
   * arrival. Returns false if it fell only on dry ink.
   */
  drop(x: number, y: number, at: number, reach: number, last: number): boolean {
    const { w, h, cost, time, wet } = this
    const cx = x * w - 0.5
    const cy = y * h - 0.5 // row 0 is the bottom, as in uv
    if (!this.#bare(cx, cy, reach * 0.75)) return false
    const reachOf = this.#reach
    const heap = this.#heap
    // Timing extends past everything still spreading, so an earlier drop's time takes over
    // smoothly where this one ends instead of a field edge cutting across a bloom.
    const horizon = Math.max(this.spreading ? this.until : -Infinity, at + last) + 0.5
    const far = reach * Math.min(4, ((horizon - at) / last) ** (1 / CREEP))
    const limit = Math.max(reach + MARGIN, far)
    const touched: number[] = []
    for (let j = Math.floor(cy); j <= Math.ceil(cy); j++) {
      for (let i = Math.floor(cx); i <= Math.ceil(cx); i++) {
        if (i < 0 || j < 0 || i >= w || j >= h) continue
        const cell = j * w + i
        if (reachOf[cell] === Infinity) touched.push(cell)
        reachOf[cell] = Math.hypot(i - cx, j - cy) * (cost[cell] ?? 1)
        heap.push(reachOf[cell] ?? 0, cell)
      }
    }
    while (heap.size) {
      const cell = heap.pop()
      const d = heap.key
      if (d > (reachOf[cell] ?? Infinity)) continue
      const ci = cell % w
      const cj = (cell - ci) / w
      const c = cost[cell] ?? 1
      for (const step of STEPS) {
        const i = ci + step.x
        const j = cj + step.y
        if (i < 0 || j < 0 || i >= w || j >= h) continue
        const next = j * w + i
        const nd = d + step.length * (c + (cost[next] ?? 1)) * 0.5
        if (nd > limit || nd >= (reachOf[next] ?? Infinity)) continue
        if (reachOf[next] === Infinity) touched.push(next)
        reachOf[next] = nd
        heap.push(nd, next)
      }
    }
    let x0 = w
    let y0 = h
    let x1 = 0
    let y1 = 0
    for (const cell of touched) {
      const d = reachOf[cell] ?? 0
      reachOf[cell] = Infinity
      time[cell] = Math.min(time[cell] ?? Infinity, at + last * (d / reach) ** CREEP)
      wet[cell] = merge(wet[cell] ?? -MARGIN, reach - d)
      const i = cell % w
      const j = (cell - i) / w
      x0 = Math.min(x0, i)
      y0 = Math.min(y0, j)
      x1 = Math.max(x1, i)
      y1 = Math.max(y1, j)
    }
    this.until = this.spreading ? Math.max(this.until, at + last) : at + last
    this.spreading = true
    this.#touch(x0, y0, x1, y1)
    return true
  }

  /** True if some paper near (cx, cy) is not under dry ink yet. */
  #bare(cx: number, cy: number, radius: number): boolean {
    const { w, h, dry } = this
    for (let j = Math.max(0, Math.floor(cy - radius)); j <= Math.min(h - 1, cy + radius); j++) {
      for (let i = Math.max(0, Math.floor(cx - radius)); i <= Math.min(w - 1, cx + radius); i++) {
        if ((i - cx) ** 2 + (j - cy) ** 2 <= radius * radius && (dry[j * w + i] ?? 0) < 1)
          return true
      }
    }
    return false
  }

  #touch(x0: number, y0: number, x1: number, y1: number): void {
    const box = this.#dirty
    this.#dirty = box
      ? [Math.min(box[0], x0), Math.min(box[1], y0), Math.max(box[2], x1), Math.max(box[3], y1)]
      : [x0, y0, x1, y1]
  }

  /** Folds the spreading ink into the dry wash once every drop has dried. Looks the same. */
  #dried(): void {
    const { time, wet, dry, mark } = this
    for (let cell = 0; cell < time.length; cell++) {
      const w = wet[cell] ?? -MARGIN
      if (w <= -MARGIN) continue
      const before = dry[cell] ?? -MARGIN
      const after = Math.max(before, w)
      // New ink gets its tide line round the wash as it is now. Older lines underneath stay, like
      // a dried edge under a later wash.
      if (before <= 0) mark[cell] = after
      dry[cell] = after
    }
    time.fill(Infinity)
    wet.fill(-MARGIN)
    this.spreading = false
    this.#touch(0, 0, this.w - 1, this.h - 1)
  }

  advance(seconds: number): void {
    // With reduced motion the ink lands and dries at once.
    if (this.reduced) {
      if (this.spreading) this.clock = Math.max(this.clock, this.until + this.settle + 0.01)
    } else this.clock += Math.max(0, seconds)
    if (this.spreading && this.clock > this.until + this.settle) this.#dried()
    // Half floats lose precision away from zero, so times are stored relative to a recent epoch.
    if (this.#rebase || Math.abs(this.clock - this.epoch) > 4) {
      this.epoch = this.clock
      this.#rebase = false
      this.#touch(0, 0, this.w - 1, this.h - 1)
    }
    const box = this.#dirty
    this.now.value = this.clock - this.epoch
    if (!box) return
    this.#dirty = undefined
    const { w, time, wet, dry, mark } = this
    const data = this.#data
    const half = DataUtils.toHalfFloat
    const edge = (v: number | undefined) => half(Math.min(8, v ?? -MARGIN))
    for (let j = box[1]; j <= box[3]; j++) {
      for (let i = box[0]; i <= box[2]; i++) {
        const cell = j * w + i
        const t = time[cell] ?? Infinity
        const o = cell * 4
        data[o] = half(t === Infinity ? 60000 : Math.max(-100, t - this.epoch))
        data[o + 1] = edge(wet[cell])
        data[o + 2] = edge(dry[cell])
        data[o + 3] = edge(mark[cell])
      }
    }
    this.map.needsUpdate = true
  }

  dispose(): void {
    this.map.dispose()
    this.fibres.dispose()
  }
}

const sheets = new WeakMap<Element, Sheet>()

/**
 * The ink effect's `animate` policy. Frames are needed while ink spreads or the paper is still
 * damp. `spread` is read live because wetter ink takes longer to settle.
 */
export function wet(ctx: Pick<EffectContext, 'element' | 'params'>): boolean {
  const sheet = sheets.get(ctx.element)
  if (!sheet) return false
  sheet.settle = Math.max(Math.max(0, Number(ctx.params.spread) || 0) * 1.2, DAMP)
  return sheet.spreading && sheet.step > 0 && !sheet.reduced
}

/** Resets the sheet to bare paper and replays its own drops. */
export function rewet(element: Element): void {
  const sheet = sheets.get(element)
  if (!sheet) return
  sheet.clear()
  sheet.seed()
  sheet.invalidate()
}

type Host = Pick<
  EffectContext,
  'element' | 'map' | 'coverUV' | 'input' | 'signal' | 'onDispose' | 'invalidate' | 'app'
> & { readonly u: { readonly size: Node<'vec2'> } }

/** Wet sheet for the ink shader. Drops follow the pointer, or a tap on touch screens. */
export function wetPaper(host: Host) {
  const { element, map, coverUV, input, signal, onDispose, invalidate, u, app } = host
  let sheet = sheets.get(element)
  if (!sheet) {
    sheet = new Sheet(input.height / Math.max(1, input.width) || 1.25)
    sheet.reduced = app.stage.reducedMotion.peek()
    sheet.seed()
    sheets.set(element, sheet)
  }
  const s = sheet
  s.users++
  clearTimeout(s.bye)
  s.invalidate = invalidate
  onDispose(() => {
    // A rebuild opens the new version before closing the old one, so the sheet is freed only
    // after it has gone unused for a while.
    if (--s.users > 0) return
    s.bye = setTimeout(() => {
      if (s.users > 0) return
      s.dispose()
      sheets.delete(element)
    }, 3000)
  })

  // Evenly spaced along the path, so a fast stroke inks as fully as a slow one.
  const pour = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' && e.type === 'pointermove' && !e.isPrimary) return
    const r = element.getBoundingClientRect()
    if (!r.width || !r.height) return
    const spacing = DROP.reach * DROP.spacing * r.width
    const reach = DROP.reach * s.w
    const to = { x: e.clientX - r.left, y: e.clientY - r.top }
    const from = e.type === 'pointerdown' || !s.last ? to : s.last
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (s.last && e.type !== 'pointerdown' && length < spacing) return
    const count = Math.max(1, Math.floor(length / spacing))
    let inked = false
    for (let k = 1; k <= count; k++) {
      const f = k / count
      const x = (from.x + (to.x - from.x) * f) / r.width
      const y = 1 - (from.y + (to.y - from.y) * f) / r.height
      const size = reach * (0.8 + s.random() * 0.45)
      const at = s.clock + (k - count) * 0.02
      inked = s.drop(x, y, at, size, DROP.last) || inked
    }
    s.last = to
    if (inked) invalidate()
  }
  const forget = (): void => {
    s.last = undefined
  }
  const target = element as HTMLElement
  target.addEventListener('pointermove', pour, { signal, passive: true })
  target.addEventListener('pointerdown', pour, { signal, passive: true })
  target.addEventListener('pointerleave', forget, { signal, passive: true })

  const light = lightOf(element, map, coverUV)
  // Cache reads per uv node so each texture is sampled once however often the shader asks.
  type Read = Record<
    'fibre' | 'speckle' | 'line' | 'dried' | 'spreading' | 'age',
    Node<'float'>
  > & {
    ink: Node<'vec4'>
  }
  const reads = new WeakMap<Node, Read>()
  const read = (uv: Node<'vec2'>): Read => {
    let r = reads.get(uv)
    if (!r) {
      const ink = texture(s.map, uv)
      const surface = texture(s.fibres, uv.mul(u.size).div(256))
      const fibre = surface.r.sub(0.5)
      // Both layers' edges fray along the same fibres, so they meet without a seam.
      const frayed = (edge: Node<'float'>) => smoothstep(-0.5, 0.5, edge.add(fibre.mul(3.4)))
      const age = s.now.sub(ink.r).add(fibre.mul(0.5))
      r = {
        ink,
        fibre,
        speckle: surface.g.sub(0.5),
        line: surface.b,
        dried: frayed(ink.b),
        spreading: frayed(ink.g).mul(smoothstep(0, 0.12, age)),
        age,
      }
      reads.set(uv, r)
    }
    return r
  }
  const ring = (edge: Node<'float'>, fibre: Node<'float'>) => {
    const d = edge.add(fibre.mul(1.6)).sub(0.7).div(0.5)
    return exp(d.mul(d).negate())
  }

  return {
    /** Ink seconds since the ink reached `uv`. Negative before, large under dry ink. */
    age: (uv: Node<'vec2'>): Node<'float'> => {
      const { dried, age } = read(uv)
      return mix(age, float(100), step(0.002, dried))
    },
    /** Ink coverage, edges frayed along the fibres. */
    reached: (uv: Node<'vec2'>): Node<'float'> => {
      const { dried, spreading } = read(uv)
      return max(dried, spreading)
    },
    /** Picture darkness 0..1, softened by `blur` mip levels and broken up by the grain. */
    dark: (uv: Node<'vec2'>, blur: Node<'float'>): Node<'float'> => {
      const tone = float(1).sub(light(uv, blur as unknown as number))
      return tone.mul(read(uv).speckle.mul(0.22).add(1))
    },
    /**
     * Darkens `ink` along the tide lines where blooms stopped. Thin ink darkens most since the
     * pigment piles up the same either way.
     */
    tide: (uv: Node<'vec2'>, ink: Node<'float'>): Node<'float'> => {
      const { ink: at, fibre, line, dried, spreading } = read(uv)
      const lines = mix(ring(at.g, fibre).mul(spreading), ring(at.a, fibre), dried)
      return ink.add(float(1.08).sub(ink).mul(lines, line, 0.34))
    },
    /** Cream paper with fibres, a shade darker where water runs ahead of the ink. */
    sheet: (uv: Node<'vec2'>, age: Node<'float'>): Node<'vec3'> => {
      const { ink, fibre, speckle } = read(uv)
      const near = smoothstep(-MARGIN, -1, ink.g)
      const damp = smoothstep(-0.7, 0, age).mul(smoothstep(DAMP, 0, age), near)
      return PAPER.mul(fibre.mul(0.06).add(speckle.mul(0.025)).add(1)).mul(damp.mul(-0.07).add(1))
    },
    flow(seconds: number): void {
      s.reduced = app.stage.reducedMotion.peek()
      s.step = seconds
      s.advance(seconds)
    },
  }
}
