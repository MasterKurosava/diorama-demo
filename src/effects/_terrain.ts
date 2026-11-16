// Terrain for the contour model, computed on the CPU. Noise in a shader is slow to compile and
// the page stops drawing while the GPU compiles. Low land is built once per model shape and each
// mountain once as a stamp. When mountains move they are stamped over the land again, which fits
// in a frame. No three.js.

/** Seeded so the land keeps its shape between visits. */
export function seeded(seed: number): () => number {
  let a = seed * 2654435761
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SIDE = 256
/** Gradient noise with derivatives. Writes [value in about -0.7..0.7, d/dx, d/dy] to `out`. */
function noise(random: () => number) {
  const grad = new Float32Array(SIDE * SIDE * 2)
  for (let i = 0; i < SIDE * SIDE; i++) {
    const a = random() * Math.PI * 2
    grad[i * 2] = Math.cos(a)
    grad[i * 2 + 1] = Math.sin(a)
  }
  const at = (i: number, j: number) => (((j & (SIDE - 1)) << 8) | (i & (SIDE - 1))) * 2
  return (x: number, y: number, out: Float64Array): void => {
    const i = Math.floor(x)
    const j = Math.floor(y)
    const fx = x - i
    const fy = y - j
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
    const dux = 30 * fx * fx * (fx * (fx - 2) + 1)
    const duy = 30 * fy * fy * (fy * (fy - 2) + 1)
    const a = at(i, j)
    const b = at(i + 1, j)
    const c = at(i, j + 1)
    const d = at(i + 1, j + 1)
    const gax = grad[a] ?? 0
    const gay = grad[a + 1] ?? 0
    const gbx = grad[b] ?? 0
    const gby = grad[b + 1] ?? 0
    const gcx = grad[c] ?? 0
    const gcy = grad[c + 1] ?? 0
    const gdx = grad[d] ?? 0
    const gdy = grad[d + 1] ?? 0
    const va = gax * fx + gay * fy
    const vb = gbx * (fx - 1) + gby * fy
    const vc = gcx * fx + gcy * (fy - 1)
    const vd = gdx * (fx - 1) + gdy * (fy - 1)
    const k4 = va - vb - vc + vd
    out[0] = va + ux * (vb - va) + uy * (vc - va) + ux * uy * k4
    out[1] =
      gax +
      ux * (gbx - gax) +
      uy * (gcx - gax) +
      ux * uy * (gax - gbx - gcx + gdx) +
      dux * (uy * k4 + vb - va)
    out[2] =
      gay +
      ux * (gby - gay) +
      uy * (gcy - gay) +
      ux * uy * (gay - gby - gcy + gdy) +
      duy * (ux * k4 + vc - va)
  }
}
type Noise = ReturnType<typeof noise>

/** Eroded fBm. Octaves fade where the land is already steep, so the valleys wind. */
function eroded(n: Noise, x: number, y: number, octaves: number, out: Float64Array): number {
  let sum = 0
  let amp = 0.6
  let gx = 0
  let gy = 0
  for (let o = 0; o < octaves; o++) {
    n(x, y, out)
    gx += out[1] ?? 0
    gy += out[2] ?? 0
    sum += (amp * (out[0] ?? 0)) / (1 + gx * gx + gy * gy)
    amp *= 0.48
    // Rotate each octave so the lattice doesn't show.
    const nx = 1.6 * x - 1.2 * y
    y = 1.2 * x + 1.6 * y
    x = nx
  }
  return sum
}

/** Ridged fBm, roughly 0..1, with sharp crests where the noise crosses zero. */
function ridged(n: Noise, x: number, y: number, octaves: number, out: Float64Array): number {
  let sum = 0
  let amp = 0.55
  let weight = 1
  for (let o = 0; o < octaves; o++) {
    n(x, y, out)
    const v = (1 - Math.abs((out[0] ?? 0) * 1.4)) ** 2 * weight
    sum += v * amp
    weight = Math.min(1, Math.max(0, v * 1.6))
    amp *= 0.5
    const nx = 1.6 * x - 1.2 * y
    y = 1.2 * x + 1.6 * y
    x = nx
  }
  return sum
}

const normalise = (field: Float32Array): void => {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const v of field) {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  const span = Math.max(1e-6, hi - lo)
  for (let i = 0; i < field.length; i++) field[i] = ((field[i] ?? 0) - lo) / span
}

/** Land without mountains, on a cols by rows grid over the model. */
export interface Ground {
  readonly cols: number
  readonly rows: number
  /** Depth over width of the model it was made for. */
  readonly aspect: number
  /** Low land, 0..1 of the relief. */
  readonly base: Float32Array
}

/**
 * Eroded rolling hills with a few sharp ridges. Grid coordinates are in model widths, so the land
 * keeps its scale whatever the model's depth.
 */
export function ground(cols: number, rows: number, aspect: number, seed: number): Ground {
  const random = seeded(seed)
  const n = noise(random)
  const ox = random() * 97
  const oy = random() * 97
  const out = new Float64Array(3)
  const base = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = ((c + 0.5) / cols) * 2.4 + ox
      const y = ((r + 0.5) / rows) * aspect * 2.4 + oy
      const ridge = ridged(n, x * 1.2 + 31, y * 1.2 + 17, 2, out)
      base[r * cols + c] = eroded(n, x, y, 4, out) + ridge * 0.28
    }
  }
  normalise(base)
  for (let i = 0; i < base.length; i++) base[i] = 0.02 + 0.17 * (base[i] ?? 0) ** 1.5
  return { cols, rows, aspect, base }
}

/** Stamp size in texels. It spans REACH radii each way from the summit. */
const STAMP = 176
const REACH = 1.5

/**
 * One mountain at unit height and radius, built once with all the noise it needs: a lobed outline,
 * ravines down the flanks and a summit that stays centred.
 */
export function stamp(seed: number): Float32Array {
  const random = seeded(seed * 7 + 101)
  const n = noise(random)
  const out = new Float64Array(3)
  const lobes = Array.from({ length: 5 }, (_, k) => ({
    k: k + 2,
    a: (random() * 0.16) / (k * 0.5 + 1),
    p: random() * Math.PI * 2,
  }))
  const field = new Float32Array(STAMP * STAMP)
  for (let r = 0; r < STAMP; r++) {
    for (let c = 0; c < STAMP; c++) {
      const x = (((c + 0.5) / STAMP) * 2 - 1) * REACH
      const y = (((r + 0.5) / STAMP) * 2 - 1) * REACH
      const d0 = Math.hypot(x, y)
      // Warp more on the flanks than near the summit.
      const w = Math.min(1, d0 * 2)
      n(x * 1.6 + 5.3, y * 1.6 + 1.7, out)
      const qx = x + (out[0] ?? 0) * 0.24 * w
      n(x * 1.6 + 9.1, y * 1.6 + 4.2, out)
      const qy = y + (out[0] ?? 0) * 0.24 * w
      const theta = Math.atan2(qy, qx)
      let lobe = 0
      for (const l of lobes) lobe += l.a * Math.cos(l.k * theta + l.p)
      const d = Math.hypot(qx, qy) / (1 + lobe * Math.min(1, d0 * 2.5))
      const s = Math.max(0, 1 - d)
      // Concave flanks under a rounded summit.
      const bell = s * s * (3 - 2 * s) * 0.7 + s ** 1.6 * 0.3
      // Spurs and ravines come from ridged noise sampled round a circle in noise space that
      // drifts with distance, so the contours bend into Vs.
      const flank = s * (1 - s) * 4
      const ax = Math.cos(theta) * 1.25 + d * 1.1 + 13
      const ay = Math.sin(theta) * 1.25 + d * 0.6 + 29
      const spur = ridged(n, ax, ay, 1, out)
      const worn = eroded(n, qx * 1.8 + 41, qy * 1.8 + 3, 2, out)
      const detail = ((spur - 0.45) * 0.34 + worn * 0.12) * flank * Math.min(1, d * 3)
      field[r * STAMP + c] = Math.max(0, bell + detail)
    }
  }
  return field
}

/** Bilinear stamp lookup in radii from the summit. 0 past its reach. */
function stampAt(field: Float32Array, x: number, y: number): number {
  const fx = (x / REACH + 1) * 0.5 * STAMP - 0.5
  const fy = (y / REACH + 1) * 0.5 * STAMP - 0.5
  if (fx < 0 || fy < 0 || fx >= STAMP - 1 || fy >= STAMP - 1) return 0
  const c = Math.floor(fx)
  const r = Math.floor(fy)
  const tx = fx - c
  const ty = fy - r
  const i = r * STAMP + c
  const a = field[i] ?? 0
  const b = field[i + 1] ?? 0
  const e = field[i + STAMP] ?? 0
  const f = field[i + STAMP + 1] ?? 0
  return a + (b - a) * tx + (e - a + (a - b - e + f) * tx) * ty
}

/** A mountain. `u` and `v` are 0..1 of the model, v towards the back. */
export interface Peak {
  u: number
  v: number
  /** Summit, 0..1 of the relief. */
  h: number
  /** Radius in widths of the model. */
  r: number
}

/** Writes the relief into `height`, each peak's stamp scaled and set over the low land. */
export function relief(
  g: Ground,
  peaks: readonly Peak[],
  stamps: readonly Float32Array[],
  height: Float32Array,
): void {
  const { cols, rows, aspect, base } = g
  height.fill(0)
  for (const [k, p] of peaks.entries()) {
    const field = stamps[k % stamps.length]
    if (p.h <= 0.001 || !field) continue
    const reach = p.r * REACH
    const c0 = Math.max(0, Math.floor((p.u - reach) * cols))
    const c1 = Math.min(cols - 1, Math.ceil((p.u + reach) * cols))
    const r0 = Math.max(0, Math.floor((p.v - reach / aspect) * rows))
    const r1 = Math.min(rows - 1, Math.ceil((p.v + reach / aspect) * rows))
    const py = p.v * aspect
    const inv = 1 / p.r
    for (let r = r0; r <= r1; r++) {
      const dy = (((r + 0.5) / rows) * aspect - py) * inv
      for (let c = c0; c <= c1; c++) {
        const dx = ((c + 0.5) / cols - p.u) * inv
        const v = stampAt(field, dx, dy)
        if (v <= 0) continue
        const i = r * cols + c
        height[i] = (height[i] ?? 0) + p.h * v
      }
    }
  }
  for (let i = 0; i < height.length; i++) {
    // Mountains sit on the land rather than replace it.
    const a = base[i] ?? 0
    let h = a + (height[i] ?? 0) * (1 - a)
    // Overlapping mountains soft-clip into a shoulder below the top of the relief.
    if (h > 0.9) h = 0.9 + (1 - Math.exp(-(h - 0.9) * 8)) * 0.095
    height[i] = Math.max(0.012, h)
  }
}

/** Relief at model uv, bilinear like the GPU sample. */
export function sample(g: Ground, height: Float32Array, u: number, v: number): number {
  const x = Math.min(g.cols - 1, Math.max(0, u * g.cols - 0.5))
  const y = Math.min(g.rows - 1, Math.max(0, v * g.rows - 0.5))
  const c = Math.min(g.cols - 2, Math.floor(x))
  const r = Math.min(g.rows - 2, Math.floor(y))
  const fx = x - c
  const fy = y - r
  const at = (cc: number, rr: number) => height[rr * g.cols + cc] ?? 0
  const top = at(c, r) + (at(c + 1, r) - at(c, r)) * fx
  const bottom = at(c, r + 1) + (at(c + 1, r + 1) - at(c, r + 1)) * fx
  return top + (bottom - top) * fy
}

/** Box blur run twice, which is soft enough for shadows and mist. */
export function blur(
  src: Float32Array,
  out: Float32Array,
  cols: number,
  rows: number,
  radius: number,
): void {
  const tmp = new Float32Array(src.length)
  const k = 1 / (radius * 2 + 1)
  // One running sum along each of `lines` lines of `n` texels, `step` apart, `stride` between lines.
  const pass = (
    from: Float32Array,
    to: Float32Array,
    n: number,
    lines: number,
    step: number,
    stride: number,
  ) => {
    for (let l = 0; l < lines; l++) {
      const o = l * stride
      let sum = 0
      for (let i = -radius; i <= radius; i++)
        sum += from[o + Math.min(n - 1, Math.max(0, i)) * step] ?? 0
      for (let i = 0; i < n; i++) {
        to[o + i * step] = sum * k
        const enter = from[o + Math.min(n - 1, i + radius + 1) * step] ?? 0
        const leave = from[o + Math.max(0, i - radius) * step] ?? 0
        sum += enter - leave
      }
    }
  }
  pass(src, tmp, cols, rows, 1, cols)
  pass(tmp, out, rows, cols, cols, 1)
  pass(out, tmp, cols, rows, 1, cols)
  pass(tmp, out, rows, cols, cols, 1)
}

/**
 * Box (u0, v0, u1, v1) of the land at or above each contour level, four numbers per level in
 * `out`, so each sheet only draws over its own island.
 */
export function bounds(g: Ground, height: Float32Array, layers: number, out: Float32Array): void {
  for (let k = 0; k < layers; k++) out.set([1, 1, 0, 0], k * 4)
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const k = Math.min(layers - 1, Math.floor((height[r * g.cols + c] ?? 0) * layers))
      const o = k * 4
      out[o] = Math.min(out[o] ?? 1, c / g.cols)
      out[o + 1] = Math.min(out[o + 1] ?? 1, r / g.rows)
      out[o + 2] = Math.max(out[o + 2] ?? 0, (c + 1) / g.cols)
      out[o + 3] = Math.max(out[o + 3] ?? 0, (r + 1) / g.rows)
    }
  }
  // A level holds every higher one.
  for (let k = layers - 2; k >= 0; k--) {
    const o = k * 4
    out[o] = Math.min(out[o] ?? 1, out[o + 4] ?? 1)
    out[o + 1] = Math.min(out[o + 1] ?? 1, out[o + 5] ?? 1)
    out[o + 2] = Math.max(out[o + 2] ?? 0, out[o + 6] ?? 0)
    out[o + 3] = Math.max(out[o + 3] ?? 0, out[o + 7] ?? 0)
  }
}

const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)
/** Half float for 0..1 values, faster than three's generic one at a whole field per frame. */
export function half(v: number): number {
  if (v < 6.11e-5) return 0
  f32[0] = Math.min(v, 65000)
  return (((u32[0] ?? 0) + 0x1000) >> 13) - 0x1c000
}

/** Tiling smooth noise for the mist, four independent layers in RGBA. */
export function haze(side: number, cells: number, seed: number): Uint8Array {
  const data = new Uint8Array(side * side * 4)
  const random = seeded(seed)
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
  return data
}
