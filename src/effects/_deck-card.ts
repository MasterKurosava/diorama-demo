import { effect } from 'dioramajs'
import {
  abs,
  color,
  float,
  length,
  max,
  min,
  normalWorldGeometry,
  positionGeometry,
  smoothstep,
  texture,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three/webgpu'
import { cardFonts, paintCard } from './_deck-art'
import { grainAt } from './_look'

// Enough for the largest card on a 2x screen.
const RES = 512
// Shadow margin around the card, px.
const PAD = 70
const RADIUS = 7
// Same sun direction as the rest of the site.
const SUN = vec3(0.45, 0.35, 1).normalize()

// One card of the deck, painted once from its DOM onto a bowing paper sheet with a shadow.
// The deck drives `bend` (bow along x and y, relative to the short side) and `lift` (0 to 1).
export const card = effect(
  { bend: [0, 0], lift: 0 },
  async ({ element, place, mask, u, onDispose, signal }) => {
    const host = element as HTMLElement
    await cardFonts(host)
    if (signal.aborted) return
    const canvas = document.createElement('canvas')
    canvas.width = RES
    paintCard(host, canvas)
    const map = new CanvasTexture(canvas)
    map.colorSpace = SRGBColorSpace
    map.anisotropy = 4
    onDispose(() => map.dispose())

    const p = positionGeometry.xy
    const side = min(u.size.x, u.size.y)
    const bow = u.bend.x
      .mul(p.x.mul(p.x))
      .add(u.bend.y.mul(p.y.mul(p.y)))
      .mul(4)
    const paper = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
    paper.positionNode = vec3(p, bow.mul(side))
    // Cheap lighting: tilt of the whole card plus the slope of the bow, no real normals.
    const q = uv().sub(0.5)
    const slope = vec2(
      u.bend.x.mul(q.x).mul(side, 8).div(u.size.x),
      u.bend.y.mul(q.y).mul(side, 8).div(u.size.y),
    )
    const facing = normalWorldGeometry.dot(SUN).div(SUN.z).sub(1).mul(0.85).add(1)
    const shade = facing.sub(slope.x.mul(0.42)).sub(slope.y.mul(0.3))
    const near = u.lift.mul(0.03).add(1)
    const ink = texture(map, uv())
    paper.colorNode = vec4(ink.rgb.mul(grainAt(uv(), vec2(1, 1).div(u.size)), shade, near), 1)
    paper.opacityNode = ink.a.mul(mask())
    const sheet = new Mesh(new PlaneGeometry(1, 1, 18, 24), paper)

    // Rounded-box SDF shadow that drifts and blurs as the card lifts.
    const grow = vec2(1, 1).add(vec2(PAD * 2, PAD * 2).div(u.size))
    const offset = vec2(-2, -4).add(vec2(-10, -20).mul(u.lift))
    const ground = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
    ground.positionNode = vec3(p.mul(grow).add(offset.div(u.size)), 0)
    const at = varying(p.mul(grow).mul(u.size))
    const blur = u.lift.mul(20).add(5)
    const k = abs(at).sub(u.size.mul(0.5)).add(RADIUS)
    const d = length(max(k, vec2(0, 0)))
      .add(min(max(k.x, k.y), 0))
      .sub(RADIUS)
    ground.colorNode = vec4(color('#07040c'), 1)
    ground.opacityNode = float(1)
      .sub(smoothstep(blur.negate(), blur, d))
      .mul(u.lift.mul(-0.06).add(0.36), u.opacity)
    const shadow = new Mesh(new PlaneGeometry(1, 1), ground)
    // Behind this card but in front of the cards below it, so it falls on them.
    shadow.position.z = -0.4

    const group = new Group()
    group.add(shadow, sheet)
    place(group, { replace: true })
  },
)
