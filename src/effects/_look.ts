// Shared GPU helpers: the low sun, the papers the scene is cut from and the arch the pictures
// are cut in. A flat print catches the sun as a soft glare that slides as the eye turns, like a
// print held in the hands.

import type { EffectContext } from '@dioramajs/diorama'
import {
  abs,
  clamp,
  color,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  luminance,
  max,
  min,
  mix,
  sin,
  smoothstep,
  texture,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node, Texture } from 'three/webgpu'
import { Color } from 'three/webgpu'
import { hero } from './_hero'

export const WARM = color('#ffcf98')

/** Soft diagonal glare across box uv, centred at `at` along the diagonal. */
export function glare(uv: Node<'vec2'>, at: Node<'float'>): Node<'float'> {
  const d = uv.x.add(uv.y.mul(0.45)).sub(at).mul(5)
  return exp(d.mul(d).negate())
}

export function glareAt(): number {
  return 0.45 + hero.view.yaw * 5 - hero.view.pitch * 3
}

/** Scene papers, nearest and darkest first. */
export const PAPERS = [
  '#3d1014',
  '#5a1b1f',
  '#86393b',
  '#a85c58',
  '#c98a80',
  '#e2a18c',
  '#f6dcc0',
].map((css) => {
  const c = new Color(css)
  return vec3(c.r, c.g, c.b)
})
const SUNWARD = vec2(0.8, 0.6)

/** Picture lightness at box uv, 0..1 over its own range. `soft` blurs by mip levels. */
export type Light = (at: Node<'vec2'>, soft: number) => Node<'float'>

const lightness = (r: number, g: number, b: number): number => {
  const lin = (v: number) => (v / 255) ** 2.2
  return (0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)) ** (1 / 2.2)
}

/**
 * Reads a picture's light with its darkest and lightest 3% as the ends of the range and the
 * median in the middle, so the papers span the whole picture whatever its exposure.
 */
export function lightOf(
  img: Element,
  map: Texture,
  cover: (uv: Node<'vec2'>) => Node<'vec2'>,
): Light {
  let range = [0, 1]
  let middle = 0.5
  try {
    const side = 64
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = side
    const g = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
    g.drawImage(img as HTMLImageElement, 0, 0, side, side)
    const px = g.getImageData(0, 0, side, side).data
    const all: number[] = []
    for (let i = 0; i < px.length; i += 4) {
      all.push(lightness(px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0))
    }
    all.sort((a, b) => a - b)
    range = [all[Math.floor(all.length * 0.03)] ?? 0, all[Math.floor(all.length * 0.97)] ?? 1]
    middle = all[Math.floor(all.length * 0.5)] ?? 0.5
  } catch {
    // Cross-origin images without CORS can't be read, so keep the full range.
  }
  const [lo = 0, hi = 1] = range
  const span = Math.max(0.1, hi - lo)
  const mid = Math.min(0.9, Math.max(0.1, (middle - lo) / span))
  const gamma = Math.min(2, Math.max(0.5, Math.log(0.5) / Math.log(mid)))
  return (at, soft) =>
    clamp(
      luminance(texture(map, cover(at)).bias(float(soft)).rgb)
        .pow(1 / 2.2)
        .sub(lo)
        .div(span),
      0,
      1,
    ).pow(gamma)
}

/** Colour of paper `k` (0 nearest to 6), blending between whole numbers. */
export function tone(k: Node<'float'>): Node<'vec3'> {
  let paper = PAPERS[0] as Node<'vec3'>
  for (const [i, colour] of PAPERS.entries()) {
    if (i > 0) paper = mix(paper, colour, clamp(k.sub(i - 1), 0, 1))
  }
  return paper
}

/** Pixel-fine paper grain. A hash, because it compiles far faster than noise. */
export function grainAt(p: Node<'vec2'>, px: Node<'vec2'>): Node<'float'> {
  return fract(sin(dot(floor(p.div(px)), vec2(12.9898, 78.233))).mul(43758.5453))
    .sub(0.5)
    .mul(0.05)
    .add(1)
}

/**
 * Cuts a picture into papers at box uv `p`, with `px` one pixel in box uv. `step` is the paper
 * there (0 nearest and darkest to 6) and `w` its edge width, about a pixel. `at` reads the light
 * in papers `offset` px towards the sun, and `paperAt` turns light into a paper.
 */
export function cut(light: Light, p: Node<'vec2'>, px: Node<'vec2'>) {
  const steps = PAPERS.length - 1
  const at = (offset: number | Node<'float'>, soft: number) =>
    light(p.add(SUNWARD.mul(px).mul(offset)), soft).mul(steps)
  // Four reads round the point, so the cut follows the picture smoothly, not its texels.
  const round = [vec2(-1, -1), vec2(1, -1), vec2(-1, 1), vec2(1, 1)].map((o) =>
    light(p.add(o.mul(px, 1.6)), 1.5),
  )
  const paperAt = (x: Node<'float'>, edge: Node<'float'> | number) =>
    floor(x).add(smoothstep(float(0.5).sub(edge), float(0.5).add(edge), fract(x)))
  const here = round
    .reduce((sum: Node<'float'>, x) => sum.add(x), float(0))
    .mul(steps / round.length)
  const w = fwidth(here).mul(0.7).max(0.02)
  return { step: paperAt(here, w), w, at, paperAt }
}

/**
 * A picture recut from the scene's papers. Darker papers are nearer and lie on top, so they cast
 * a soft shadow away from the sun and catch it on their cut edges, like the ridges do.
 */
export function papers(light: Light, p: Node<'vec2'>, px: Node<'vec2'>): Node<'vec3'> {
  const { step, w, at, paperAt } = cut(light, p, px)
  // A darker paper sunward lies over this one and shades it. A paler one there means this is
  // the cut edge of a nearer paper, which catches the light.
  const shadow = clamp(step.sub(paperAt(at(7, 3), 0.3)), 0, 1)
  const edge = clamp(paperAt(at(2.5, 2.5), w).sub(step), 0, 1)
  return tone(step).mul(grainAt(p, px), shadow.mul(-0.24).add(1), edge.mul(0.26).add(1))
}

/**
 * The arch the pictures are cut in, a box with a half-circle top and its foot lost in the valley
 * mist. `inside` is 1 within it with a one-pixel soft edge, and `rim` is the cut edge facing the
 * sun. `open` (0..1) squares off the top and lifts the foot out of the mist.
 */
export function arch(p: Node<'vec2'>, size: Node<'vec2'>, open: Node<'float'>) {
  const at = p.mul(size)
  const r = size.x.mul(0.5).mul(float(1).sub(open)).max(0.001)
  const shoulder = size.y.sub(r)
  // Signed distance, the nearer of the box below the shoulders and the round cap.
  const q = at.sub(vec2(clamp(at.x, r, size.x.sub(r)), shoulder))
  const cap = q.length().sub(r)
  const half = vec2(size.x, shoulder).mul(0.5)
  const e = abs(at.sub(half)).sub(half)
  const body = max(e, vec2(0, 0))
    .length()
    .add(min(max(e.x, e.y), 0))
  const d = min(cap, body)
  const out = vec2(q.x, max(q.y, 0))
  const facing = max(out.div(max(out.length(), 1e-3)).dot(SUNWARD), 0).mul(float(1).sub(open))
  const foot = mix(smoothstep(0, 0.14, p.y), float(1), open)
  return { inside: smoothstep(0.75, -0.75, d).mul(foot), rim: smoothstep(-3, -0.5, d).mul(facing) }
}

type Ripples = Pick<EffectContext, 'element' | 'map' | 'coverUV' | 'surface'> & {
  readonly u: {
    readonly size: Node<'vec2'>
    readonly pointer: Node<'vec2'>
    readonly time: Node<'float'>
    readonly hover: Node<'float'>
  }
}

/**
 * A picture cut from the scene's papers, with rings under the pointer that run through the papers
 * and catch the light. The landscape picture and its card share it, so the handover between them
 * changes nothing on screen.
 */
export function paperSurface(
  { element, map, coverUV, surface, u }: Ripples,
  strength: Node<'float'>,
): void {
  const rings = (here: Node<'vec2'>) => {
    const toPointer = here.sub(u.pointer).mul(vec2(u.size.x.div(u.size.y), 1))
    const d = toPointer.length()
    const height = sin(d.mul(38).sub(u.time.mul(4.5)))
      .mul(exp(d.mul(-4.2)))
      .mul(u.hover, strength)
    return { toPointer, height }
  }
  surface.uv((here) => {
    const r = rings(here)
    return here.add(r.toPointer.add(vec2(1e-5, 0)).normalize().mul(r.height.mul(0.012)))
  })
  const light = lightOf(element, map, coverUV)
  surface.color((color, { uv: here, box }) => {
    const r = rings(box)
    // The rings lift the light a little too, so they run through the papers as contours.
    const lift = r.height.mul(0.09)
    const paper = papers(
      (where, soft) => light(where, soft).add(lift),
      here,
      vec2(1, 1).div(u.size),
    )
    return vec4(paper.add(WARM.mul(r.height.max(0).mul(0.3))), color.a)
  })
}
