// Card art on a plain 2D canvas, one paper scene per hour from dusk to dawn. Both the DOM cards
// and the deck's GL copies are painted here, so the handover between them is invisible.
// Files starting with `_` are helpers, not effects.

// Dusk papers, darkest to palest, then night inks.
const P = ['#3d1014', '#5a1b1f', '#86393b', '#a85c58', '#c98a80', '#e2a18c', '#f6dcc0'] as const
const N = ['#121427', '#1c2040', '#2a2f5a', '#3f4475', '#61649a'] as const
const SUN = '#ffcf98'
const CREAM = '#f3e9d8'

type Rgb = [number, number, number]
// Accepts '#rrggbb' and both rgb() syntaxes.
const rgb = (css: string): Rgb => {
  if (css.startsWith('#')) {
    const n = Number.parseInt(css.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const [r = 0, g = 0, b = 0] = (css.match(/[\d.]+/g) ?? []).map(Number)
  return [r, g, b]
}
const mix = (a: string, b: string, t: number): string => {
  const x = rgb(a)
  const y = rgb(b)
  return `rgb(${x.map((v, i) => Math.round(v + ((y[i] as number) - v) * t)).join(' ')})`
}

// Up and to the right, same as the sun in the 3D scene.
const SUNWARD = [0.8, -0.6] as const

interface Pen {
  readonly g: CanvasRenderingContext2D
  readonly w: number
  readonly h: number
  /** Paper thickness in px. */
  readonly u: number
}

/** A paper cutout with a drop shadow and a sunlit edge. `lift` scales its height off the layer below. */
function sheet(pen: Pen, path: Path2D, fill: string, lift = 1, rule: CanvasFillRule = 'nonzero') {
  const { g, u } = pen
  g.save()
  g.shadowColor = 'rgba(16, 4, 10, 0.42)'
  g.shadowBlur = 5 * u * lift
  g.shadowOffsetX = -1.6 * u * lift
  g.shadowOffsetY = 2.2 * u * lift
  g.fillStyle = fill
  g.fill(path, rule)
  g.restore()
  // Lit edge: fill bright, then cover with the same shape shifted away from the sun.
  g.save()
  g.clip(path, rule)
  g.fillStyle = mix(fill, SUN, 0.32)
  g.fill(path, rule)
  g.translate(-SUNWARD[0] * u * 0.9, -SUNWARD[1] * u * 0.9)
  g.fillStyle = fill
  g.fill(path, rule)
  g.restore()
}

/** Hills (or waves with `cusp`) from a wavy line at `base`, a fraction of the height, to the bottom. */
function ridge(pen: Pen, base: number, amp: number, seed: number, freq = 1, cusp = false): Path2D {
  const { w, h } = pen
  const p = new Path2D()
  p.moveTo(-0.1 * w, h * 1.1)
  for (let i = 0; i <= 96; i++) {
    const x = -0.1 + (i / 96) * 1.2
    const t = Math.PI * (x * freq * 2 + seed)
    const y = cusp
      ? base + amp * Math.abs(Math.sin(t)) ** 0.75
      : base +
        amp *
          (0.55 * Math.sin(t) +
            0.3 * Math.sin(t * 2.35 + seed * 1.7) +
            0.15 * Math.sin(t * 4.65 + seed * 2.3))
    p.lineTo(x * w, y * h)
  }
  p.lineTo(1.1 * w, h * 1.1)
  p.closePath()
  return p
}

function disc(pen: Pen, x: number, y: number, r: number): Path2D {
  const p = new Path2D()
  p.arc(x * pen.w, y * pen.h, r * pen.w, 0, Math.PI * 2)
  return p
}

function sky(pen: Pen, top: string, low: string, at = 0.55) {
  const { g, w, h } = pen
  g.fillStyle = top
  g.fillRect(0, 0, w, h)
  const band = new Path2D()
  band.rect(-w * 0.1, at * h, w * 1.2, h)
  g.fillStyle = low
  g.fill(band)
}

/** Disc minus a second disc offset by (dx, dy) radii and scaled by `k`. */
function crescent(pen: Pen, x: number, y: number, r: number, dx: number, dy: number, k: number) {
  const { w, h } = pen
  const x1 = x * w
  const y1 = y * h
  const r1 = r * w
  const x2 = x1 + dx * r1
  const y2 = y1 + dy * r1
  const r2 = r1 * k
  const d = Math.hypot(dx * r1, dy * r1)
  const phi = Math.atan2(dy, dx)
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
  const alpha = Math.acos(Math.min(1, a / r1))
  const beta = Math.acos(Math.min(1, (d - a) / r2))
  const p = new Path2D()
  p.arc(x1, y1, r1, phi + alpha, phi - alpha + Math.PI * 2, false)
  p.arc(x2, y2, r2, phi + Math.PI + beta, phi + Math.PI - beta, true)
  p.closePath()
  return p
}

function bird(pen: Pen, x: number, y: number, s: number): Path2D {
  const { w, h } = pen
  const cx = x * w
  const cy = y * h
  const S = s * w
  const p = new Path2D()
  p.moveTo(cx - S, cy - 0.2 * S)
  p.quadraticCurveTo(cx - 0.5 * S, cy - 0.42 * S, cx, cy + 0.1 * S)
  p.quadraticCurveTo(cx + 0.5 * S, cy - 0.42 * S, cx + S, cy - 0.2 * S)
  p.quadraticCurveTo(cx + 0.45 * S, cy - 0.12 * S, cx, cy + 0.34 * S)
  p.quadraticCurveTo(cx - 0.45 * S, cy - 0.12 * S, cx - S, cy - 0.2 * S)
  return p
}

function pine(pen: Pen, x: number, base: number, height: number): Path2D {
  const { w, h } = pen
  const p = new Path2D()
  const X = x * w
  const H = height * h
  const B = base * h
  const half = H * 0.3
  for (let i = 0; i < 4; i++) {
    const top = B - H + i * H * 0.2
    const foot = top + H * 0.36
    const spread = half * (0.45 + i * 0.22)
    p.moveTo(X, top)
    p.lineTo(X + spread, foot)
    p.lineTo(X - spread, foot)
    p.closePath()
  }
  p.rect(X - H * 0.025, B - H * 0.2, H * 0.05, H * 0.25)
  return p
}

function stars(pen: Pen, count: number, seed: number, below = 0.55) {
  const { g, w, h, u } = pen
  let s = seed
  const rand = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  g.fillStyle = CREAM
  for (let i = 0; i < count; i++) {
    const x = rand() * w
    const y = rand() * h * below
    const r = (0.35 + rand() * 0.75) * u
    g.globalAlpha = 0.45 + rand() * 0.5
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1
}

const MOTIFS: Record<string, (pen: Pen) => void> = {
  sunset(pen) {
    sky(pen, P[6], mix(P[6], P[5], 0.5), 0.5)
    sheet(pen, disc(pen, 0.6, 0.44, 0.27), mix(P[6], SUN, 0.55), 0.6)
    sheet(pen, disc(pen, 0.6, 0.44, 0.17), SUN, 0.8)
    sheet(pen, ridge(pen, 0.6, 0.05, 0.2, 0.8), P[5])
    sheet(pen, ridge(pen, 0.69, 0.05, 1.1, 1.1), P[4])
    sheet(pen, ridge(pen, 0.77, 0.045, 0.6, 1.3), P[3])
    sheet(pen, ridge(pen, 0.86, 0.04, 1.7, 0.9), P[2])
    sheet(pen, ridge(pen, 0.95, 0.035, 0.4, 1.2), P[1])
  },
  ridges(pen) {
    sky(pen, mix(P[6], P[5], 0.25), P[5], 0.42)
    sheet(pen, disc(pen, 0.74, 0.28, 0.09), mix(SUN, CREAM, 0.4), 0.5)
    sheet(pen, ridge(pen, 0.42, 0.09, 0.3, 0.7), P[4])
    sheet(pen, ridge(pen, 0.52, 0.1, 1.3, 0.8), P[3])
    sheet(pen, ridge(pen, 0.63, 0.09, 0.8, 0.9), P[2])
    sheet(pen, ridge(pen, 0.75, 0.08, 1.9, 1.0), P[1])
    sheet(pen, ridge(pen, 0.88, 0.06, 0.1, 1.1), P[0])
  },
  swifts(pen) {
    sky(pen, P[5], mix(P[5], P[4], 0.6), 0.62)
    sheet(pen, disc(pen, 0.5, 0.62, 0.36), mix(P[6], SUN, 0.3), 0.5)
    sheet(pen, ridge(pen, 0.84, 0.03, 0.5, 0.6), P[2])
    sheet(pen, ridge(pen, 0.93, 0.025, 1.4, 0.8), P[1])
    sheet(pen, bird(pen, 0.36, 0.34, 0.15), P[0], 1.4)
    sheet(pen, bird(pen, 0.66, 0.24, 0.1), P[0], 1.2)
    sheet(pen, bird(pen, 0.58, 0.47, 0.07), P[1], 1)
  },
  lantern(pen) {
    const { g, w, h, u } = pen
    sky(pen, N[1], N[1])
    stars(pen, 26, 7, 0.7)
    sheet(pen, disc(pen, 0.5, 0.5, 0.34), mix(N[2], P[3], 0.22), 0.4)
    sheet(pen, disc(pen, 0.5, 0.5, 0.25), mix(N[3], P[4], 0.3), 0.5)
    sheet(pen, disc(pen, 0.5, 0.5, 0.17), mix(N[4], SUN, 0.35), 0.6)
    g.fillStyle = mix(CREAM, N[2], 0.4)
    g.fillRect(0.5 * w - 0.4 * u, 0, 0.8 * u, 0.36 * h)
    const body = new Path2D()
    body.ellipse(0.5 * w, 0.5 * h, 0.12 * w, 0.14 * h, 0, 0, Math.PI * 2)
    sheet(pen, body, SUN, 1.2)
    g.strokeStyle = mix(SUN, P[4], 0.6)
    g.lineWidth = 0.9 * u
    for (const k of [-0.6, 0, 0.6]) {
      g.beginPath()
      g.ellipse(0.5 * w, 0.5 * h, Math.abs(k) * 0.12 * w + 0.002 * w, 0.14 * h, 0, 0, Math.PI * 2)
      g.stroke()
    }
    const caps = new Path2D()
    caps.rect(0.43 * w, 0.345 * h, 0.14 * w, 0.03 * h)
    caps.rect(0.43 * w, 0.625 * h, 0.14 * w, 0.03 * h)
    sheet(pen, caps, P[0], 1.2)
    sheet(pen, ridge(pen, 0.86, 0.04, 0.9, 0.7), N[0], 1.2)
  },
  moon(pen) {
    sky(pen, N[2], mix(N[2], N[3], 0.5), 0.6)
    stars(pen, 30, 3, 0.6)
    sheet(pen, crescent(pen, 0.42, 0.36, 0.2, 0.42, -0.24, 0.86), CREAM, 1.1)
    sheet(pen, ridge(pen, 0.62, 0.03, 0.4, 0.5), N[3], 0.8)
    sheet(pen, ridge(pen, 0.72, 0.06, 1.2, 0.8), N[2])
    sheet(pen, ridge(pen, 0.83, 0.05, 0.7, 1.1), N[1])
    sheet(pen, ridge(pen, 0.93, 0.04, 1.6, 1.3), N[0])
  },
  tide(pen) {
    sky(pen, N[2], N[2])
    stars(pen, 18, 11, 0.4)
    sheet(pen, disc(pen, 0.7, 0.24, 0.08), CREAM, 0.8)
    sheet(pen, ridge(pen, 0.46, 0.05, 0.3, 2.2, true), N[3], 0.8)
    sheet(pen, ridge(pen, 0.58, 0.06, 0.8, 1.8, true), mix(N[3], N[2], 0.5))
    sheet(pen, ridge(pen, 0.7, 0.07, 0.1, 1.5, true), N[2])
    sheet(pen, ridge(pen, 0.82, 0.08, 0.6, 1.2, true), N[1])
    sheet(pen, ridge(pen, 0.93, 0.07, 0.2, 1.0, true), N[0])
  },
  pines(pen) {
    sky(pen, mix(N[3], P[2], 0.35), mix(P[3], P[5], 0.3), 0.6)
    sheet(pen, ridge(pen, 0.66, 0.03, 0.3, 0.6), mix(P[2], N[2], 0.3), 0.7)
    const back = new Path2D()
    for (const [x, s] of [
      [0.12, 0.3],
      [0.3, 0.24],
      [0.52, 0.34],
      [0.78, 0.27],
      [0.95, 0.31],
    ] as const) {
      back.addPath(pine(pen, x, 0.78, s))
    }
    sheet(pen, back, P[1], 0.9)
    sheet(pen, ridge(pen, 0.8, 0.02, 1.4, 0.8), P[1])
    const front = new Path2D()
    for (const [x, s] of [
      [0.2, 0.5],
      [0.4, 0.38],
      [0.68, 0.56],
      [0.88, 0.4],
    ] as const) {
      front.addPath(pine(pen, x, 0.97, s))
    }
    sheet(pen, front, P[0], 1.2)
    sheet(pen, ridge(pen, 0.95, 0.02, 0.6, 1.1), P[0])
  },
  dawn(pen) {
    const { g, w, h } = pen
    sky(pen, P[6], mix(P[6], SUN, 0.35), 0.5)
    const rays = new Path2D()
    for (let i = 0; i < 9; i++) {
      const a0 = Math.PI * (1 + (i + 0.25) / 9)
      const a1 = Math.PI * (1 + (i + 0.62) / 9)
      rays.moveTo(0.5 * w, 0.66 * h)
      rays.lineTo(0.5 * w + Math.cos(a0) * w, 0.66 * h + Math.sin(a0) * w)
      rays.lineTo(0.5 * w + Math.cos(a1) * w, 0.66 * h + Math.sin(a1) * w)
      rays.closePath()
    }
    g.fillStyle = mix(P[6], SUN, 0.55)
    g.fill(rays)
    sheet(pen, disc(pen, 0.5, 0.66, 0.2), SUN, 0.8)
    sheet(pen, ridge(pen, 0.7, 0.015, 0.2, 1.6, true), P[5])
    sheet(pen, ridge(pen, 0.79, 0.025, 0.7, 1.3, true), P[4])
    sheet(pen, ridge(pen, 0.88, 0.03, 0.3, 1.1, true), P[3])
    sheet(pen, ridge(pen, 0.96, 0.03, 0.9, 0.9, true), P[2])
  },
}

export function paintMotif(g: CanvasRenderingContext2D, motif: string, w: number, h: number): void {
  const paint = MOTIFS[motif] ?? MOTIFS.sunset
  g.save()
  g.beginPath()
  g.rect(0, 0, w, h)
  g.clip()
  paint?.({ g, w, h, u: w / 150 })
  g.restore()
}

function arch(x: number, y: number, w: number, h: number): Path2D {
  const r = w / 2
  const p = new Path2D()
  p.moveTo(x, y + h)
  p.lineTo(x, y + r)
  p.arc(x + r, y + r, r, Math.PI, 0)
  p.lineTo(x + w, y + h)
  p.closePath()
  return p
}

const STRETCH: readonly [number, string][] = [
  [62.5, 'extra-condensed'],
  [75, 'condensed'],
  [87.5, 'semi-condensed'],
  [100, 'normal'],
  [112.5, 'semi-expanded'],
  [125, 'expanded'],
]
const stretchOf = (css: string): CanvasFontStretch => {
  const v = css.endsWith('%') ? Number.parseFloat(css) : 100
  let best = STRETCH[3] as [number, string]
  for (const s of STRETCH) if (Math.abs(s[0] - v) < Math.abs(best[0] - v)) best = s
  return best[1] as CanvasFontStretch
}

/** Canvas text silently falls back if the web font isn't loaded yet, so load it first. */
export function cardFonts(card: Element): Promise<unknown> {
  const words = [...card.querySelectorAll<HTMLElement>('[data-ink]')]
  return Promise.all(
    words.map((el) => {
      const s = getComputedStyle(el)
      return document.fonts.load(`${s.fontWeight} 16px ${s.fontFamily}`).catch(() => [])
    }),
  )
}

/**
 * Copies the card's DOM layout onto `canvas`: paper, the motif in `.card-art`, and each
 * `[data-ink]` text with its computed font and position. Keeps the canvas width and sets the
 * height from the card's aspect.
 */
export function paintCard(card: HTMLElement, canvas: HTMLCanvasElement): void {
  const W = card.offsetWidth || 3
  const H = card.offsetHeight || 4
  const k = canvas.width / W
  canvas.height = Math.round(H * k)
  const g = canvas.getContext('2d') as CanvasRenderingContext2D
  const cw = canvas.width
  const ch = canvas.height
  const paper = getComputedStyle(card).backgroundColor
  const u = cw / 150
  g.clearRect(0, 0, cw, ch)

  const art = card.querySelector<HTMLElement>('.card-art')
  const ax = (art?.offsetLeft ?? 0) * k
  const ay = (art?.offsetTop ?? 0) * k
  const aw = (art?.offsetWidth ?? 0) * k
  const ah = (art?.offsetHeight ?? 0) * k
  g.save()
  g.translate(ax, ay)
  paintMotif(g, card.dataset.motif ?? '', aw, ah)
  g.restore()

  // evenodd cuts the arch window out of the card.
  const frame = new Path2D()
  frame.rect(-cw, -ch, cw * 3, ch * 3)
  frame.addPath(arch(ax, ay, aw, ah))
  const pen = { g, w: cw, h: ch, u }
  g.save()
  g.beginPath()
  g.rect(0, 0, cw, ch)
  g.clip()
  sheet(pen, frame, paper, 1.3, 'evenodd')
  // Thin highlight on the sunward top and right edges.
  g.fillStyle = 'rgba(255, 246, 228, 0.55)'
  g.fillRect(0, 0, cw, 1.1 * u * 0.4)
  g.fillRect(cw - 1.1 * u * 0.4, 0, cw, ch)
  g.restore()

  for (const el of card.querySelectorAll<HTMLElement>('[data-ink]')) {
    const s = getComputedStyle(el)
    const size = Number.parseFloat(s.fontSize) * k
    g.save()
    g.font = `${s.fontStyle} ${s.fontWeight} ${size}px ${s.fontFamily}`
    g.fontStretch = stretchOf(s.fontStretch)
    g.letterSpacing = `${(Number.parseFloat(s.letterSpacing) || 0) * k}px`
    g.fillStyle = s.color
    g.globalAlpha = Number.parseFloat(s.opacity) || 1
    g.textBaseline = 'alphabetic'
    const raw = el.textContent ?? ''
    const text = s.textTransform === 'uppercase' ? raw.toUpperCase() : raw
    const m = g.measureText(text)
    const top = el.offsetTop * k
    const height = el.offsetHeight * k
    g.fillText(
      text,
      el.offsetLeft * k,
      top + (height + m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2,
    )
    g.restore()
  }
}
