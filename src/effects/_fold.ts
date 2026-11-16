// What the fold effect reads from the page: where the browser set each word and letter, grouped
// into paper strips (one per line or per word), and the text painted into a canvas exactly where
// the browser drew it.

/** A paper strip in px from the element's top left, y down. */
export interface Strip {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  /** Point along the strip that stays put while folding, 0 left end to 1 right end. */
  readonly anchor: number
  /** Crease positions in px from the strip's left end, ascending. */
  readonly creases: readonly number[]
  /** Line index and position within the line (always 0 for line strips). */
  readonly line: number
  readonly order: number
}

interface Piece {
  readonly text: string
  readonly rect: DOMRect
  readonly style: CSSStyleDeclaration
  /** Gaps between letters in viewport px, measured for words only. */
  readonly gaps: readonly number[]
}

/** Canvas fontStretch only takes keywords, so CSS percentages snap to the nearest one. */
const STRETCH: readonly [number, CanvasFontStretch][] = [
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

const stretchOf = (css: string): CanvasFontStretch => {
  const pct = css.endsWith('%') ? Number.parseFloat(css) : 100
  let best = STRETCH[4] as [number, CanvasFontStretch]
  for (const s of STRETCH) if (Math.abs(s[0] - pct) < Math.abs(best[0] - pct)) best = s
  return best[1]
}

const transform = (text: string, how: string): string =>
  how === 'uppercase'
    ? text.toUpperCase()
    : how === 'lowercase'
      ? text.toLowerCase()
      : how === 'capitalize'
        ? text.replace(/(^|\s)(\S)/g, (_, a: string, b: string) => a + b.toUpperCase())
        : text

/** Every word of the element as the browser set it, in document order. */
function pieces(host: HTMLElement, letters: boolean): Piece[] {
  const out: Piece[] = []
  const range = document.createRange()
  const styles = new Map<Element, CSSStyleDeclaration>()
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    const text = node.textContent ?? ''
    if (!parent || !text.trim()) continue
    let style = styles.get(parent)
    if (!style) {
      style = getComputedStyle(parent)
      styles.set(parent, style)
    }
    for (const m of text.matchAll(/\S+/g)) {
      const start = m.index
      range.setStart(node, start)
      range.setEnd(node, start + m[0].length)
      const rects = range.getClientRects()
      const rect = rects[0]
      // A word broken over two lines (hyphen, long URL) is rare. Keep its first line only.
      if (!rect || rect.width === 0) continue
      const gaps: number[] = []
      if (letters) {
        let at = start
        let prev: DOMRect | undefined
        for (const ch of m[0]) {
          range.setStart(node, at)
          range.setEnd(node, at + ch.length)
          const r = range.getBoundingClientRect()
          if (prev && r.width > 0) gaps.push((prev.right + r.left) / 2)
          if (r.width > 0) prev = r
          at += ch.length
        }
      }
      out.push({ text: transform(m[0], style.textTransform), rect, style, gaps })
    }
  }
  return out
}

/** Groups pieces into lines. Same line if their middles are within half a height. */
function lines(all: readonly Piece[]): Piece[][] {
  const out: Piece[][] = []
  for (const p of all) {
    const last = out.at(-1)
    const ref = last?.[0]?.rect
    const mid = p.rect.top + p.rect.height / 2
    if (last && ref && Math.abs(mid - (ref.top + ref.height / 2)) < ref.height / 2) last.push(p)
    else out.push([p])
  }
  return out
}

/**
 * One strip per line or per word, the text box padded by `pad` em. Lines crease on one grid
 * across the element, `folds` panels wide, so creases line up between lines. Words crease between
 * letters at the gaps nearest that grid.
 */
export function strips(
  host: HTMLElement,
  by: 'line' | 'word',
  folds: number,
  pad: readonly [number, number],
): Strip[] {
  const box = host.getBoundingClientRect()
  const all = pieces(host, by === 'word')
  const align = getComputedStyle(host).textAlign
  const rtl = getComputedStyle(host).direction === 'rtl'
  const lineAnchor =
    align === 'center'
      ? 0.5
      : align === 'right' || (align === 'end' && !rtl) || (align === 'start' && rtl)
        ? 1
        : 0
  // A pleat narrower than about a letter and a half reads as squeezed text, not folded paper.
  const em = Number.parseFloat(all[0]?.style.fontSize ?? '16') || 16
  const panel =
    box.width / Math.max(1, Math.min(Math.round(folds), Math.floor(box.width / (1.3 * em))))
  const grid = (from: number, to: number): number[] => {
    const out: number[] = []
    for (let x = Math.ceil(from / panel) * panel; x < to; x += panel) out.push(x)
    return out
  }
  type Raw = {
    l: number
    t: number
    r: number
    b: number
    gaps: number[]
    line: number
    order: number
  }
  const raw: Raw[] = []
  for (const [line, group] of lines(all).entries()) {
    const size = Number.parseFloat(group[0]?.style.fontSize ?? '16') || 16
    const px = pad[0] * size
    const py = pad[1] * size
    const parts = by === 'line' ? [group] : group.map((p) => [p])
    for (const [order, part] of parts.entries()) {
      raw.push({
        l: Math.min(...part.map((p) => p.rect.left)) - box.left - px,
        r: Math.max(...part.map((p) => p.rect.right)) - box.left + px,
        t: Math.min(...part.map((p) => p.rect.top)) - box.top - py,
        b: Math.max(...part.map((p) => p.rect.bottom)) - box.top + py,
        gaps: part.flatMap((p) => p.gaps.map((g) => g - box.left)),
        line,
        order,
      })
    }
  }
  // Overlapping strips would z-fight since the paper is coplanar. Neighbours meet halfway, a
  // pixel apart.
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1] as Raw
    const b = raw[i] as Raw
    if (a.line !== b.line || a.r + 1 <= b.l) continue
    const mid = (a.r + b.l) / 2
    a.r = mid - 0.5
    b.l = mid + 0.5
  }
  for (const a of raw) {
    for (const b of raw) {
      if (b.line !== a.line + 1 || b.l >= a.r || b.r <= a.l || a.b + 1 <= b.t) continue
      const mid = (a.b + b.t) / 2
      a.b = Math.min(a.b, mid - 0.5)
      b.t = Math.max(b.t, mid + 0.5)
    }
  }
  return raw.map(({ l, t, r, b, gaps, line, order }) => {
    const width = r - l
    let creases: number[]
    if (by === 'line') {
      creases = grid(l + panel * 0.35, r - panel * 0.35)
      // A line shorter than a panel still folds once, in its middle.
      if (!creases.length && width > panel * 0.25) creases = [l + width / 2]
    } else {
      const free = [...gaps]
      creases = []
      for (const g of grid(l, r)) {
        let best = -1
        for (const [i, x] of free.entries()) {
          if (best < 0 || Math.abs(x - g) < Math.abs((free[best] as number) - g)) best = i
        }
        if (best >= 0) creases.push(...free.splice(best, 1))
      }
      // A word narrower than a panel folds once, at its middle gap.
      if (!creases.length && gaps.length) {
        const mid = l + width / 2
        creases = [gaps.reduce((a, x) => (Math.abs(x - mid) < Math.abs(a - mid) ? x : a))]
      }
      creases.sort((a, x) => a - x)
    }
    return {
      left: l,
      top: t,
      width,
      height: b - t,
      anchor: by === 'line' ? lineAnchor : 0.5,
      creases: creases.map((x) => x - l),
      line,
      order,
    }
  })
}

/** Painted text placement in its canvas in css px, `uv = (px + offset) / size`. */
export interface Ink {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A canvas laid over the element at `scale`, its origin on the page's device pixel grid. */
function sheet(host: HTMLElement, canvas: HTMLCanvasElement, scale: number) {
  const box = host.getBoundingClientRect()
  const pageX = box.left + scrollX
  const pageY = box.top + scrollY
  const x = pageX - Math.floor(pageX * scale) / scale
  const y = pageY - Math.floor(pageY * scale) / scale
  const w = Math.max(1, Math.ceil((box.width + x) * scale))
  const h = Math.max(1, Math.ceil((box.height + y) * scale))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const g = canvas.getContext('2d') as CanvasRenderingContext2D
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, w, h)
  // Draw in element px from here on.
  g.setTransform(scale, 0, 0, scale, x * scale, y * scale)
  g.fillStyle = '#fff'
  return { g, box, ink: { x, y, width: w / scale, height: h / scale } }
}

/**
 * Paints the element's text into `canvas` where the browser drew it, white on transparent, at
 * `scale` canvas px per css px. The origin snaps to the page's device pixel grid, so at rest each
 * texel lands on a screen pixel and the text is as sharp as the page's.
 */
export function paint(host: HTMLElement, canvas: HTMLCanvasElement, scale: number): Ink {
  const { g, box, ink } = sheet(host, canvas, scale)
  g.textBaseline = 'alphabetic'
  const metrics = new Map<string, TextMetrics>()
  for (const p of pieces(host, false)) {
    const s = p.style
    g.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`
    g.fontStretch = stretchOf(s.fontStretch)
    g.fontKerning = s.fontKerning === 'none' ? 'none' : 'normal'
    g.letterSpacing = s.letterSpacing === 'normal' ? '0px' : s.letterSpacing
    const key = `${g.font}|${g.fontStretch}`
    let m = metrics.get(key)
    if (!m) {
      m = g.measureText('Hg')
      metrics.set(key, m)
    }
    const r = p.rect
    const base = r.top + (r.height + m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2
    // Snap baselines to whole canvas pixels, which are also page pixels.
    const y = Math.round((base - box.top + ink.y) * scale) / scale - ink.y
    g.fillText(p.text, r.left - box.left, y)
  }
  return ink
}

/**
 * Paints the page selection inside the element into `canvas`, laid out like `paint`. The page
 * hides the selection along with the element, so the paper shows it instead. Returns whether
 * anything is selected there.
 */
export function marks(host: HTMLElement, canvas: HTMLCanvasElement, scale: number): boolean {
  const { g, box } = sheet(host, canvas, scale)
  const selection = getSelection()
  let any = false
  if (!selection || selection.isCollapsed) return any
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i)
    if (!range.intersectsNode(host)) continue
    const part = range.cloneRange()
    if (!host.contains(part.startContainer)) part.setStart(host, 0)
    if (!host.contains(part.endContainer)) part.setEnd(host, host.childNodes.length)
    // Text rects only, since an element's box would include its padding.
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    const piece = document.createRange()
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!part.intersectsNode(node)) continue
      const length = node.textContent?.length ?? 0
      piece.setStart(node, node === part.startContainer ? part.startOffset : 0)
      piece.setEnd(node, node === part.endContainer ? part.endOffset : length)
      for (const r of piece.getClientRects()) {
        if (r.width < 0.5) continue
        g.fillRect(r.left - box.left, r.top - box.top, r.width, r.height)
        any = true
      }
    }
  }
  return any
}
