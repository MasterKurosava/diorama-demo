// Ice textures baked on the CPU. Procedural noise in the shader made compiles slow enough to
// freeze the page.
//
// relief, 512x256: surface normal in rg, thickness in b, hoar frost in a.
// detail, 2048x1024: bubble and fracture normals in rg, fracture sheen in b, edge and bubble
//   highlights in a.
// frost, 2048x1024: fern frost in r, its regrow time in g (0 first), needle crystals in b.

export const RELIEF = { width: 512, height: 256 } as const
export const DETAIL = { width: 2048, height: 1024 } as const

export interface Baked {
  readonly relief: Uint8Array<ArrayBuffer>
  readonly detail: Uint8Array<ArrayBuffer>
  readonly frost: Uint8Array<ArrayBuffer>
}

/** Seeded so the cracks are the same on every visit. */
export function seeded(seed: number): () => number {
  let a = seed * 2654435761
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
const byte = (v: number): number => Math.round(clamp01(v) * 255)
// Yields between heavy steps when baking runs on the main thread.
const breathe = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

function valueNoise(w: number, h: number, cells: number, random: () => number): Float32Array {
  const cw = cells
  const ch = Math.max(1, Math.round((cells * h) / w))
  const lattice = Float32Array.from({ length: (cw + 1) * (ch + 1) }, random)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const v = (y / h) * ch
    const j = Math.floor(v)
    const sv = (v - j) * (v - j) * (3 - 2 * (v - j))
    for (let x = 0; x < w; x++) {
      const u = (x / w) * cw
      const i = Math.floor(u)
      const su = (u - i) * (u - i) * (3 - 2 * (u - i))
      const a = lattice[j * (cw + 1) + i] as number
      const b = lattice[j * (cw + 1) + i + 1] as number
      const c = lattice[(j + 1) * (cw + 1) + i] as number
      const d = lattice[(j + 1) * (cw + 1) + i + 1] as number
      out[y * w + x] = a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv
    }
  }
  return out
}

function fbm(
  w: number,
  h: number,
  base: number,
  octaves: number,
  random: () => number,
): Float32Array {
  const out = new Float32Array(w * h)
  let amp = 1
  let total = 0
  for (let o = 0; o < octaves; o++) {
    const layer = valueNoise(w, h, base * 2 ** o, random)
    for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) + (layer[i] as number) * amp
    total += amp
    amp *= 0.5
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / total
  return out
}

function relief(): Uint8Array<ArrayBuffer> {
  const { width: w, height: h } = RELIEF
  const random = seeded(5)
  const surface = fbm(w, h, 4, 3, random)
  const thick = fbm(w, h, 3, 3, random)
  const hoar = fbm(w, h, 8, 4, random)
  const out = new Uint8Array(w * h * 4)
  const at = (x: number, y: number): number =>
    surface[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] as number
  const depth = 9
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const nx = -(at(x + 1, y) - at(x - 1, y)) * depth
      const ny = -(at(x, y + 1) - at(x, y - 1)) * depth
      out[i * 4] = byte(0.5 + nx * 0.5)
      out[i * 4 + 1] = byte(0.5 + ny * 0.5)
      out[i * 4 + 2] = byte(((thick[i] as number) - 0.25) * 2)
      out[i * 4 + 3] = byte(((hoar[i] as number) - 0.28) * 2.4)
    }
  }
  return out
}

class Field {
  readonly data: Float32Array
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Float32Array(w * h)
  }
  /** Max-blends a disc with a one-texel soft edge. */
  max(x: number, y: number, r: number, v: number): void {
    const x0 = Math.max(0, Math.floor(x - r - 1))
    const x1 = Math.min(this.w - 1, Math.ceil(x + r + 1))
    const y0 = Math.max(0, Math.floor(y - r - 1))
    const y1 = Math.min(this.h - 1, Math.ceil(y + r + 1))
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const k = clamp01(r + 0.5 - Math.hypot(i - x, j - y)) * v
        const at = j * this.w + i
        if (k > (this.data[at] as number)) this.data[at] = k
      }
    }
  }
  blur(r: number): void {
    const { w, h, data } = this
    const row = new Float32Array(Math.max(w, h))
    const pass = (n: number, count: number, index: (line: number, k: number) => number): void => {
      for (let line = 0; line < count; line++) {
        let sum = 0
        for (let k = -r; k <= r; k++)
          sum += data[index(line, Math.min(n - 1, Math.max(0, k)))] as number
        for (let k = 0; k < n; k++) {
          row[k] = sum / (2 * r + 1)
          sum +=
            (data[index(line, Math.min(n - 1, k + r + 1))] as number) -
            (data[index(line, Math.max(0, k - r))] as number)
        }
        for (let k = 0; k < n; k++) data[index(line, k)] = row[k] as number
      }
    }
    pass(w, h, (y, x) => y * w + x)
    pass(h, w, (x, y) => y * w + x)
  }
}

interface Step {
  readonly x: number
  readonly y: number
  readonly a: number
}

/** Wandering one-texel steps with an occasional sharp kink. */
function path(
  x: number,
  y: number,
  angle: number,
  length: number,
  random: () => number,
  kink = 0.006,
): Step[] {
  const points: Step[] = []
  let a = angle
  for (let s = 0; s < length; s++) {
    points.push({ x, y, a })
    a += (random() - 0.5) * 0.1 + (random() < kink ? (random() - 0.5) * 0.8 : 0)
    x += Math.cos(a)
    y += Math.sin(a)
  }
  return points
}

async function detail(): Promise<Uint8Array<ArrayBuffer>> {
  const { width: w, height: h } = DETAIL
  const random = seeded(17)
  const sheen = new Field(w, h)
  const glint = new Field(w, h)
  const wedge = new Field(w, h)
  const bubbles = new Field(w, h)

  // A fracture is a bright edge plus a plane sloping into the ice on one side. The plane gets
  // hackle ribs running away from the edge and faint arrest lines across them, like real ice.
  // Hairline cracks branch off the edge.
  const fracture = (
    x: number,
    y: number,
    angle: number,
    length: number,
    width: number,
    bright: number,
  ): void => {
    const side = random() < 0.5 ? -1 : 1
    const line = path(x, y, angle, length, random)
    const phase = random() * 10
    for (const [s, p] of line.entries()) {
      const along = s / length
      const wide =
        width *
        (0.3 + 0.7 * Math.sin(Math.PI * Math.min(1, along * 1.1)) ** 0.6) *
        (0.75 + 0.25 * Math.sin(s * 0.04 + phase))
      const nx = -Math.sin(p.a) * side
      const ny = Math.cos(p.a) * side
      const rib = Math.abs(Math.sin(s * 0.42 + Math.sin(s * 0.05 + phase) * 3))
      const hackle = 0.3 + 0.7 * rib ** 5
      // Uneven edge brightness reads more natural than a constant line.
      const lit = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(s * 0.018 + phase)) ** 2
      for (let u = 0; u < wide; u += 0.7) {
        const k = (1 - u / wide) ** 1.4
        const px = Math.round(p.x + nx * u)
        const py = Math.round(p.y + ny * u)
        if (px < 0 || py < 0 || px >= w || py >= h) continue
        const i = py * w + px
        const arrest = 0.85 + 0.15 * Math.cos(u * 0.9 + s * 0.01)
        const v = k * hackle * arrest * bright
        if (v > (sheen.data[i] as number)) sheen.data[i] = v
        if (k > (wedge.data[i] as number)) wedge.data[i] = k
      }
      glint.max(p.x, p.y, 0.45, bright * lit)
    }
    for (let n = Math.floor(length / 80); n > 0; n--) {
      const from = line[Math.floor(random() * line.length)]
      if (!from) continue
      const turn = (random() < 0.5 ? -1 : 1) * (0.5 + random() * 0.9)
      const hair = path(from.x, from.y, from.a + turn, 16 + random() * 70, random, 0.02)
      for (const [s, q] of hair.entries())
        glint.max(q.x, q.y, 0.35, bright * 0.5 * (1 - s / hair.length))
    }
  }
  for (let n = 0; n < 6; n++) {
    fracture(
      w * (0.08 + random() * 0.84),
      h * (0.12 + random() * 0.76),
      random() * Math.PI * 2,
      300 + random() * 700,
      24 + random() * 56,
      0.6 + random() * 0.4,
    )
  }
  // Impact star, as if a stone hit the ice.
  {
    const x = w * (0.3 + random() * 0.4)
    const y = h * (0.3 + random() * 0.4)
    const arms = 6
    for (let a = 0; a < arms; a++) {
      fracture(
        x,
        y,
        (a / arms) * Math.PI * 2 + random() * 0.4,
        50 + random() * 80,
        10 + random() * 14,
        0.7,
      )
    }
  }
  await breathe()

  // Bubbles go in as a height dome (for refraction) and a bright rim. Clusters, rising chains,
  // then a dusting of tiny ones.
  const bubble = (x: number, y: number, r: number, stretch = 1): void => {
    const ry = r * stretch
    const x0 = Math.max(0, Math.floor(x - r - 1))
    const x1 = Math.min(w - 1, Math.ceil(x + r + 1))
    const y0 = Math.max(0, Math.floor(y - ry - 1))
    const y1 = Math.min(h - 1, Math.ceil(y + ry + 1))
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const d = Math.hypot(i - x, (j - y) / stretch) / r
        const at = j * w + i
        const silver =
          clamp01((1 + 0.6 / r - d) * r) * (0.35 + 0.65 * clamp01((d - 0.45) / 0.5) ** 2)
        if (silver > (glint.data[at] as number)) glint.data[at] = silver
        if (d >= 1) continue
        const dome = Math.sqrt(1 - d * d) * r
        if (dome > (bubbles.data[at] as number)) bubbles.data[at] = dome
      }
    }
  }
  for (let c = 0; c < 8; c++) {
    const cx = w * (0.06 + random() * 0.88)
    const cy = h * (0.08 + random() * 0.84)
    const spread = 30 + random() * 90
    for (let n = 12 + Math.floor(random() * 40); n > 0; n--) {
      const a = random() * Math.PI * 2
      const d = spread * Math.sqrt(-2 * Math.log(1 - random() * 0.98)) * 0.6
      const big = random() < 0.1
      bubble(
        cx + Math.cos(a) * d,
        cy + Math.sin(a) * d,
        big ? 4.5 + random() * 5 : 1.5 + random() * 2.5,
      )
    }
  }
  for (let c = 0; c < 10; c++) {
    let x = w * (0.05 + random() * 0.9)
    let y = h * random() * 0.5
    const a = Math.PI / 2 + (random() - 0.5) * 0.35
    const length = 140 + random() * 420
    for (let s = 0; s < length; s += 6 + random() * 10) {
      x += Math.cos(a) * 8 + (random() - 0.5) * 2
      y += Math.sin(a) * 8
      bubble(x, y, 1 + random() * 1.8, 1.4 + random() * 0.8)
    }
  }
  for (let n = 0; n < 420; n++) bubble(random() * w, random() * h, 0.8 + random() * 1.2)
  await breathe()

  wedge.blur(1)
  sheen.blur(1)
  const lens = new Float32Array(w * h)
  for (let i = 0; i < lens.length; i++)
    lens[i] = (wedge.data[i] as number) * 5 + (bubbles.data[i] as number) * 0.4
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const l = lens[y * w + Math.max(0, x - 1)] as number
      const r = lens[y * w + Math.min(w - 1, x + 1)] as number
      const b = lens[Math.max(0, y - 1) * w + x] as number
      const t = lens[Math.min(h - 1, y + 1) * w + x] as number
      // A slope of 2 maps to the full byte. Bubble rims are steeper and just clip.
      out[i * 4] = byte(0.5 - (r - l) * 0.125)
      out[i * 4 + 1] = byte(0.5 - (t - b) * 0.125)
      out[i * 4 + 2] = byte(sheen.data[i] as number)
      out[i * 4 + 3] = byte(glint.data[i] as number)
    }
  }
  return out
}

/** OffscreenCanvas so this also runs in the worker. */
function sheet(fill: string): OffscreenCanvasRenderingContext2D {
  const canvas = new OffscreenCanvas(DETAIL.width, DETAIL.height)
  const g = canvas.getContext('2d', {
    willReadFrequently: true,
  }) as OffscreenCanvasRenderingContext2D
  g.fillStyle = fill
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  return g
}

async function frost(): Promise<Uint8Array<ArrayBuffer>> {
  const { width: w, height: h } = DETAIL
  const random = seeded(29)
  const fern = sheet('#000')
  // Grey level is the time a crystal grows. 'darken' keeps the earliest where they overlap.
  const when = sheet('#fff')
  when.globalCompositeOperation = 'darken'
  const fine = sheet('#000')

  // Fern frost: a stem with branches at 60 degrees, longest mid-stem like a feather, plus
  // twigs. Grows outward from the root.
  const feather = (x0: number, y0: number, angle: number, length: number, start: number): void => {
    const levels: [number, number][][][] = [[], [], []]
    const branch = (x: number, y: number, a: number, span: number, level: number): void => {
      const line: [number, number][] = [[x, y]]
      const step = level === 0 ? 2 : 1.4
      let next = level === 0 ? 4 : 2.5 + random() * 2
      let side = random() < 0.5 ? -1 : 1
      for (let s = 0; s < span; s += step) {
        a += (random() - 0.5) * (level === 0 ? 0.04 : 0.07)
        x += Math.cos(a) * step
        y += Math.sin(a) * step
        line.push([x, y])
        if (level < 2 && s >= next) {
          const shape = Math.sin(Math.PI * Math.min(1, s / span)) ** 0.8
          const reach =
            level === 0 ? length * 0.24 * shape * (0.75 + random() * 0.5) : (span - s) * 0.42
          const turn = Math.PI / 3 + (random() - 0.5) * 0.2
          if (reach > 3) {
            branch(x, y, a + turn * side, reach, level + 1)
            // Paired on the stem, alternating on branches.
            if (level === 0)
              branch(x, y, a - turn * side, reach * (0.8 + random() * 0.3), level + 1)
          }
          side = -side
          next = s + (level === 0 ? 5 + random() * 5 : 2.5 + random() * 2.5)
        }
      }
      levels[level]?.push(line)
    }
    branch(x0, y0, angle, length, 0)
    const reach = length * 1.15
    const t0 = Math.round(start * 255)
    const t1 = Math.round(Math.min(1, start + length / 700) * 255)
    const widths = [1.7, 1.05, 0.7]
    const alphas = [0.9, 0.75, 0.55]
    for (const [level, lines] of levels.entries()) {
      const draw = (g: OffscreenCanvasRenderingContext2D, style: string | CanvasGradient): void => {
        g.beginPath()
        for (const line of lines) {
          for (const [i, [x, y]] of line.entries()) {
            if (i === 0) g.moveTo(x, y)
            else g.lineTo(x, y)
          }
        }
        g.lineWidth = widths[level] ?? 1
        g.strokeStyle = style
        g.stroke()
      }
      draw(fern, `rgba(255,255,255,${alphas[level] ?? 0.5})`)
      const grows = when.createRadialGradient(x0, y0, 0, x0, y0, reach)
      grows.addColorStop(0, `rgb(${t0},${t0},${t0})`)
      grows.addColorStop(1, `rgb(${t1},${t1},${t1})`)
      draw(when, grows)
    }
  }
  for (let n = 0; n < 26; n++) {
    feather(
      random() * w,
      random() * h,
      random() * Math.PI * 2,
      260 + random() * 520,
      random() * 0.25,
    )
  }
  for (let n = 0; n < 60; n++) {
    feather(
      random() * w,
      random() * h,
      random() * Math.PI * 2,
      70 + random() * 200,
      0.1 + random() * 0.4,
    )
  }
  await breathe()

  // Needle crystals regrow first.
  for (let batch = 0; batch < 8; batch++) {
    fine.beginPath()
    when.beginPath()
    for (let n = 0; n < 2400; n++) {
      const x = random() * w
      const y = random() * h
      const a = random() * Math.PI * 2
      const length = 2 + random() * 9
      fine.moveTo(x, y)
      fine.lineTo(x + Math.cos(a) * length, y + Math.sin(a) * length)
      when.moveTo(x, y)
      when.lineTo(x + Math.cos(a) * length, y + Math.sin(a) * length)
    }
    fine.lineWidth = 0.75
    fine.strokeStyle = `rgba(255,255,255,${0.45 + batch * 0.06})`
    fine.stroke()
    const t = Math.round((0.04 + batch * 0.05) * 255)
    when.lineWidth = 0.75
    when.strokeStyle = `rgb(${t},${t},${t})`
    when.stroke()
  }
  await breathe()

  const a = fern.getImageData(0, 0, w, h).data
  const b = when.getImageData(0, 0, w, h).data
  const c = fine.getImageData(0, 0, w, h).data
  const out = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = a[i * 4] as number
    out[i * 4 + 1] = b[i * 4] as number
    out[i * 4 + 2] = c[i * 4] as number
    out[i * 4 + 3] = 255
  }
  return out
}

/** Runs in the worker, or on the main thread as a fallback. */
export async function bakeAll(): Promise<Baked> {
  const r = relief()
  await breathe()
  const d = await detail()
  await breathe()
  const f = await frost()
  return { relief: r, detail: d, frost: f }
}
