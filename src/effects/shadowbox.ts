import { effect } from '@dioramajs/diorama'
import {
  cameraPosition,
  clamp,
  color,
  float,
  instanceIndex,
  max,
  min,
  mix,
  modelWorldMatrixInverse,
  positionGeometry,
  smoothstep,
  step,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { InstancedMesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu'
import { hero, LANDED, smooth } from './_hero'
import { cut, grainAt, lightOf, PAPERS, tone } from './_look'

/** Gap between sheets when open, px. */
const GAP = 16
/** Slide of the farthest sheet with the pointer at the box edge, px. */
const LEAN = 30
/** Mat width when open, as a fraction of the box's shorter side. */
const MAT = 0.05
/** Sheet overhang past the window on each side, as a fraction of the box, so they can slide. */
const MARGIN = 0.2

// The cut-paper picture as a shadow box. Each paper is its own sheet, darkest nearest, behind a
// mat with a window. Closed it's the flat picture. Open, the sheets separate in depth, shadow
// the ones behind and parallax with the pointer. On the hero's landing card it opens after the
// photo lands, on the project page it starts open.
export default effect(
  {},
  { media: true, animate: 'visible' },
  ({ element, map, coverUV, place, mask, u }) => {
    const light = lightOf(element, map, coverUV)
    const open = uniform(0)
    const look = uniform(vec2(0, 0))
    const far = PAPERS.length - 1

    // One instanced draw, back to front, so it blends in order without depth writes. The mat is
    // the last instance, in the box's plane.
    const k = float(instanceIndex)
    const isMat = step(far + 0.5, k)
    const sheet = float(far).sub(k).max(0)
    const depth = sheet.mul(open, GAP)

    // W is a point on the mat plane in box units. Each sheet pushes it back along the eye ray onto
    // its own plane, so every sheet sits exactly behind the window at any perspective (a box near
    // the top of the screen is seen from below), then slides. `seen` is the point projected back
    // onto the mat plane, where the window is cut.
    const W = positionGeometry.xy.mul(mix(float(1 + 2 * MARGIN), float(1), isMat))
    const eye = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz
    const t = eye.z.div(eye.z.add(depth))
    const slide = look.mul(sheet, open, LEAN / far).div(u.size)
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
    material.positionNode = vec3(eye.xy.add(W.sub(eye.xy).div(t)).add(slide), depth.negate())
    const seen = varying(W.add(slide.mul(t)))
    const p = varying(W).add(0.5)

    // Signed px distances to the window edges on the mat plane, positive outside.
    const at = seen.mul(u.size)
    const half = vec2(0.5, 0.5)
      .mul(u.size)
      .sub(open.mul(MAT, min(u.size.x, u.size.y)))
    const left = half.x.negate().sub(at.x)
    const right = at.x.sub(half.x)
    const bottom = half.y.negate().sub(at.y)
    const top = at.y.sub(half.y)
    const out = max(max(left, right), max(bottom, top))
    const inWindow = smoothstep(0.5, -0.5, out)
    const box = seen.abs().sub(0.5).mul(u.size)
    const inBox = smoothstep(0.5, -0.5, max(box.x, box.y))

    const px = vec2(1, 1).div(u.size)
    const c = cut(light, p, px)
    // A sheet also holds every darker paper in front of it. From the front only its own shows,
    // but in depth its cut edges stand clear of the sheets behind.
    const holds = clamp(sheet.add(1).sub(c.step), 0, 1)
    // Nearer sheets cast shadow away from the sun, longer as the box opens. Cut edges catch the
    // light as on the flat picture.
    const shadow = clamp(sheet.sub(c.paperAt(c.at(open.mul(16).add(7), 3), 0.3)), 0, 1).mul(
      open.mul(0.14).add(0.24),
    )
    const edge = clamp(c.paperAt(c.at(2.5, 2.5), c.w).sub(sheet), 0, 1)
    // The mat shades the sheets under its top and right (sun side) edges, and a little all round.
    const sunSide = smoothstep(30, 0, min(top.negate(), right.negate())).mul(0.32)
    const round = smoothstep(10, 0, out.negate()).mul(0.12)
    const underMat = sunSide.add(round).mul(open)
    const paper = tone(sheet)
      .mul(grainAt(p, px))
      .mul(shadow.oneMinus(), edge.mul(0.26).add(1), underMat.oneMinus())
    // Pale board. The window bevel catches the sun on the bottom and left.
    const lit = step(max(top, right), max(bottom, left))
    const bevel = smoothstep(4, 1, out).mul(lit.mul(0.16).sub(lit.oneMinus().mul(0.1)))
    const board = color('#f1e2cf').mul(grainAt(p, px)).mul(bevel.add(1))
    material.colorNode = vec4(mix(paper, board, isMat), 1)
    material.opacityNode = mix(holds.mul(inWindow), inBox.mul(inWindow.oneMinus()), isMat).mul(
      mask(seen.add(0.5)),
    )

    const sheets = new InstancedMesh(new PlaneGeometry(1, 1), material, PAPERS.length + 1)
    sheets.frustumCulled = false
    place(sheets, { replace: true })

    // On the hero card it opens after landing and closes quickly on the way back, before the
    // photo takes over again.
    const card = !!element.closest('.landing')
    let progress = !card || hero.flight > LANDED ? 1 : 0
    return (input) => {
      const want = !card || hero.flight > LANDED
      progress = Math.min(
        1,
        Math.max(0, progress + (want ? input.delta / 1.3 : -input.delta / 0.3)),
      )
      open.value = hero.reduced ? (want ? 1 : 0) : smooth(0, 1, progress)
      if (card) hero.parted = open.value
      const ease = Math.min(1, input.delta * 4)
      const tx = input.hover && !hero.reduced ? input.pointer.x - 0.5 : 0
      const ty = input.hover && !hero.reduced ? input.pointer.y - 0.5 : 0
      look.value.x += (tx - look.value.x) * ease
      look.value.y += (ty - look.value.y) * ease
    }
  },
)
