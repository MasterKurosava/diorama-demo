// The text of an element drawn into a canvas where the browser laid it out, word by word, so
// an effect can burn it in GL. Enough for the plain blocks of the lantern page: one font per
// text node, solid colours, text-shadows without blur.

/** A run of words on one line, in box px (y down). */
export interface Line {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

export interface Raster {
  readonly canvas: HTMLCanvasElement
  /** The canvas in box px (y down): x, y, width, height. */
  readonly frame: readonly [number, number, number, number]
  readonly lines: readonly Line[]
  /** Left and right ends of the ink in box px. */
  readonly left: number
  readonly right: number
  /** Largest font size in px. */
  readonly em: number
}

const STRETCH: [number, string][] = [
  [50, 'ultra-condensed'],
  [62.5, 'extra-condensed'],
  [75, 'condensed'],
  [87.5, 'semi-condensed'],
  [100, 'normal'],
  [112.5, 'semi-expanded'],
  [125, 'expanded'],
  [150, 'extra-expanded'],
  [200, 'ultra-expanded'],
]

function stretchOf(value: string): CanvasFontStretch {
  const pct = value.endsWith('%') ? Number.parseFloat(value) : 100
  let best = STRETCH[4] as [number, string]
  for (const s of STRETCH) if (Math.abs(s[0] - pct) < Math.abs(best[0] - pct)) best = s
  return best[1] as CanvasFontStretch
}

/** `rgb(…) 2px 2px 0px, …` as [colour, x, y] in paint order, bottom first. */
function shadows(value: string): [string, number, number][] {
  if (!value || value === 'none') return []
  const out: [string, number, number][] = []
  for (const part of value.split(/,(?![^(]*\))/)) {
    const color = part.match(/rgba?\([^)]*\)|#[0-9a-f]+/i)?.[0]
    const [x = 0, y = 0] = (part.replace(color ?? '', '').match(/-?[\d.]+px/g) ?? []).map(
      Number.parseFloat,
    )
    if (color) out.unshift([color, x, y])
  }
  return out
}

interface Word {
  readonly text: string
  readonly rect: DOMRect
  readonly style: CSSStyleDeclaration
}

/** Draws the element's text. `pad` px of room are left around the ink and the box. */
export function raster(element: Element, pad: number, maxSide = 2048): Raster {
  const box = element.getBoundingClientRect()
  const words: Word[] = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    const data = node.textContent ?? ''
    if (!parent || !data.trim()) continue
    const style = getComputedStyle(parent)
    if (style.visibility === 'hidden' || style.display === 'none') continue
    const upper = style.textTransform === 'uppercase'
    for (const m of data.matchAll(/\S+/g)) {
      range.setStart(node, m.index)
      range.setEnd(node, m.index + m[0].length)
      const rect = range.getClientRects()[0]
      if (!rect || rect.width === 0) continue
      words.push({ text: upper ? m[0].toUpperCase() : m[0], rect, style })
    }
  }
  range.detach()

  let x0 = 0
  let y0 = 0
  let x1 = box.width
  let y1 = box.height
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let em = 0
  const lines: { left: number; right: number; top: number; bottom: number }[] = []
  for (const { rect, style } of words) {
    em = Math.max(em, Number.parseFloat(style.fontSize) || 0)
    const l = rect.left - box.left
    const t = rect.top - box.top
    x0 = Math.min(x0, l)
    y0 = Math.min(y0, t)
    x1 = Math.max(x1, l + rect.width)
    y1 = Math.max(y1, t + rect.height)
    left = Math.min(left, l)
    right = Math.max(right, l + rect.width)
    const line = lines.find((n) => Math.abs(n.top - t) < rect.height * 0.5)
    if (line) {
      line.left = Math.min(line.left, l)
      line.right = Math.max(line.right, l + rect.width)
      line.bottom = Math.max(line.bottom, t + rect.height)
    } else lines.push({ left: l, right: l + rect.width, top: t, bottom: t + rect.height })
  }
  const frame: [number, number, number, number] = [
    Math.floor(x0 - pad),
    Math.floor(y0 - pad),
    Math.ceil(x1 - x0 + pad * 2),
    Math.ceil(y1 - y0 + pad * 2),
  ]
  const ratio = Math.min(devicePixelRatio || 1, 2, maxSide / Math.max(frame[2], frame[3]))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(frame[2] * ratio))
  canvas.height = Math.max(1, Math.round(frame[3] * ratio))
  const g = canvas.getContext('2d') as CanvasRenderingContext2D
  g.scale(ratio, ratio)
  g.textBaseline = 'alphabetic'
  for (const { text, rect, style } of words) {
    g.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    g.fontStretch = stretchOf(style.fontStretch)
    g.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing
    g.fontKerning = 'normal'
    // A text range's box is the font's content area, so its top is the baseline minus the ascent.
    const x = rect.left - box.left - frame[0]
    const y = rect.top - box.top - frame[1] + g.measureText(text).fontBoundingBoxAscent
    for (const [color, dx, dy] of shadows(style.textShadow)) {
      g.fillStyle = color
      g.fillText(text, x + dx, y + dy)
    }
    g.fillStyle = style.color
    g.fillText(text, x, y)
  }
  return {
    canvas,
    frame,
    lines,
    left: Number.isFinite(left) ? left : 0,
    right: Number.isFinite(right) ? right : box.width,
    em: em || 16,
  }
}
