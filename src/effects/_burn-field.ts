// Burn shape on the CPU. The noise is baked once into a texture because noise functions in a
// shader take long to compile and the page freezes meanwhile. The shader mirrors the ignition
// field, and this copy tells where the fire starts and ends and when the front reaches a spark.

import {
  DataTexture,
  LinearFilter,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
} from 'three/webgpu'

const SIDE = 256

/** Seeded random (a mulberry32 variant), so a sheet burns the same way every time. */
export function seeded(seed: number): () => number {
  let a = seed * 2654435761
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Adds one octave of gradient noise, tiling every `cells` cells. */
function octave(out: Float32Array, cells: number, amp: number, random: () => number): void {
  const gx = new Float32Array(cells * cells)
  const gy = new Float32Array(cells * cells)
  for (let i = 0; i < cells * cells; i++) {
    const a = random() * Math.PI * 2
    gx[i] = Math.cos(a)
    gy[i] = Math.sin(a)
  }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  const step = cells / SIDE
  for (let y = 0; y < SIDE; y++) {
    const j = Math.floor(y * step)
    const fy = y * step - j
    const v = fade(fy)
    const r0 = j * cells
    const r1 = ((j + 1) % cells) * cells
    for (let x = 0; x < SIDE; x++) {
      const i = Math.floor(x * step)
      const fx = x * step - i
      const u = fade(fx)
      const i1 = (i + 1) % cells
      const a = (gx[r0 + i] ?? 0) * fx + (gy[r0 + i] ?? 0) * fy
      const b = (gx[r0 + i1] ?? 0) * (fx - 1) + (gy[r0 + i1] ?? 0) * fy
      const c = (gx[r1 + i] ?? 0) * fx + (gy[r1 + i] ?? 0) * (fy - 1)
      const d = (gx[r1 + i1] ?? 0) * (fx - 1) + (gy[r1 + i1] ?? 0) * (fy - 1)
      out[y * SIDE + x] =
        (out[y * SIDE + x] ?? 0) + (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * amp
    }
  }
}

/** Histogram equalization to 0..255, so the fire front moves at an even pace. */
function equalize(values: Float32Array): Uint8Array {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const v of values) {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  const bins = 2048
  const scale = (bins - 1) / Math.max(1e-6, hi - lo)
  const count = new Uint32Array(bins)
  for (const v of values) {
    const bin = Math.round((v - lo) * scale)
    count[bin] = (count[bin] ?? 0) + 1
  }
  const cdf = new Float32Array(bins)
  let sum = 0
  for (let i = 0; i < bins; i++) {
    sum += count[i] ?? 0
    cdf[i] = sum / values.length
  }
  const out = new Uint8Array(values.length)
  for (let i = 0; i < values.length; i++) {
    out[i] = Math.round((cdf[Math.round(((values[i] ?? 0) - lo) * scale)] ?? 0) * 255)
  }
  return out
}

let baked: Uint8Array | undefined

/**
 * Four tiling noises in one 256px texture. R is the front's shape, G its ragged edge, B blobs for
 * embers left in the char, A a soft noise for the flame flicker.
 */
export function noiseData(): Uint8Array {
  if (baked) return baked
  const random = seeded(97)
  const layers: [number, number][] = [
    [4, 4],
    [16, 2],
    [48, 1],
    [6, 2],
  ]
  const data = new Uint8Array(SIDE * SIDE * 4)
  for (const [ch, [base, octaves]] of layers.entries()) {
    const values = new Float32Array(SIDE * SIDE)
    for (let o = 0; o < octaves; o++) octave(values, base << o, 0.5 ** o, random)
    const ranked = equalize(values)
    for (let i = 0; i < ranked.length; i++) data[i * 4 + ch] = ranked[i] ?? 0
  }
  baked = data
  return data
}

/** A new texture per instance, so disposing one doesn't break the others. */
export function noiseTexture(): DataTexture {
  const map = new DataTexture(noiseData(), SIDE, SIDE, RGBAFormat, UnsignedByteType)
  map.wrapS = map.wrapT = RepeatWrapping
  map.magFilter = map.minFilter = LinearFilter
  map.generateMipmaps = false
  map.needsUpdate = true
  return map
}

/** Samples channel `ch` with bilinear filtering, matching what the GPU reads. One tile per unit. */
export function noiseAt(ch: number, u: number, v: number): number {
  const data = noiseData()
  const x = u * SIDE - 0.5
  const y = v * SIDE - 0.5
  const i = Math.floor(x)
  const j = Math.floor(y)
  const fx = x - i
  const fy = y - j
  const at = (a: number, b: number): number =>
    data[((((b % SIDE) + SIDE) % SIDE) * SIDE + (((a % SIDE) + SIDE) % SIDE)) * 4 + ch] ?? 0
  const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fx
  const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx
  return (top + (bottom - top) * fy) / 255
}

/** Ignition point in box px, y up. */
export interface Spark {
  x: number
  y: number
  speed: number
  delay: number
}

/**
 * When each point of a sheet catches fire, in px of front travel. Must match the sum the shader
 * builds from the same numbers.
 */
export interface Field {
  width: number
  height: number
  /** Edge term is distance * edge[0] + edge[1]. [0, 1e5] disables edges. */
  edge: [number, number]
  /** Speed 0 means unused. */
  points: [Spark, Spark, Spark]
  /** Distance scale up and down. Fire climbs, so up is cheaper. */
  climb: [number, number]
  /** px per noise tile, then how far the coarse and fine noise push the front. */
  tile: number
  amp: number
  fine: number
}

const NONE: Spark = { x: 0, y: 0, speed: 0, delay: 0 }

export function fieldAt(f: Field, x: number, y: number): number {
  const e = Math.min(x, f.width - x, y, f.height - y) * f.edge[0] + f.edge[1]
  let d = e
  for (const p of f.points) {
    if (p.speed <= 0) continue
    const dx = x - p.x
    const dy = (y - p.y) * (y > p.y ? f.climb[0] : f.climb[1])
    d = Math.min(d, Math.hypot(dx, dy) / p.speed + p.delay)
  }
  const u = x / f.tile
  const v = y / f.tile
  return d + (noiseAt(0, u, v) - 0.5) * f.amp + (noiseAt(1, u, v) - 0.5) * f.fine
}

/** Min and max of the field over the box, i.e. when the fire starts and ends. */
export function extent(f: Field): [number, number] {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  const n = 48
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const v = fieldAt(f, (i / n) * f.width, (j / n) * f.height)
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
  }
  return [lo, hi]
}

/**
 * On leave the sheet burns from an edge point (usually the bottom), then from inside, and the
 * edges catch later. On enter it grows from two points near the middle, corners last.
 */
export function fields(
  width: number,
  height: number,
  seed: number,
): { leave: Field; enter: Field } {
  const random = seeded(seed)
  const s = Math.min(width, height) / 2
  const tile = Math.min(900, Math.max(280, s * 2.4))
  const shared = { width, height, tile, amp: s * 0.62, fine: Math.min(18, Math.max(6, s * 0.08)) }
  const between = (a: number, b: number) => a + (b - a) * random()
  // Just outside the sheet. Bottom most often, top least.
  const side = random()
  const along = between(0.18, 0.82)
  const out = 8
  const edge: Spark =
    side < 0.45
      ? { x: along * width, y: -out, speed: 1, delay: 0 }
      : side < 0.65
        ? { x: -out, y: along * height * 0.7, speed: 1, delay: 0 }
        : side < 0.85
          ? { x: width + out, y: along * height * 0.7, speed: 1, delay: 0 }
          : { x: along * width, y: height + out, speed: 1, delay: 0 }
  const inside: Spark = {
    x: between(0.25, 0.75) * width,
    y: between(0.22, 0.62) * height,
    speed: 0.8,
    delay: s * between(0.12, 0.3),
  }
  // Big sheets get a third spark on a side edge.
  const third: Spark =
    s > 200
      ? {
          x: random() < 0.5 ? -out : width + out,
          y: between(0.1, 0.5) * height,
          speed: 0.9,
          delay: s * 0.35,
        }
      : NONE
  const leave: Field = {
    ...shared,
    edge: [1.5, s * 0.42],
    points: [edge, inside, third],
    climb: [0.62, 1.3],
  }
  const enter: Field = {
    ...shared,
    edge: [0, 1e5],
    points: [
      { x: between(0.38, 0.62) * width, y: between(0.38, 0.62) * height, speed: 1, delay: 0 },
      { x: between(0.2, 0.8) * width, y: between(0.2, 0.8) * height, speed: 0.85, delay: s * 0.15 },
      NONE,
    ],
    climb: [1, 1],
  }
  return { leave, enter }
}
