import { effect } from 'dioramajs'
import {
  clamp,
  dot,
  faceDirection,
  max,
  mix,
  normalWorldGeometry,
  positionView,
  smoothstep,
  vec3,
  vec4,
} from 'three/tsl'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  Quaternion,
  Vector3,
} from 'three/webgpu'
import { D } from './_hero'
import { WARM } from './_look'

type Point = readonly [number, number, number]

// Non-indexed on purpose: computeVertexNormals then gives flat faces and the folds stay crisp.
function folded(faces: readonly (readonly [Point, Point, Point])[]): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(faces.flat(2), 3))
  geometry.computeVertexNormals()
  return geometry
}

// Three-faced spike from base triangle (a, b, c) to `tip`.
const spike = (a: Point, b: Point, c: Point, tip: Point): [Point, Point, Point][] => [
  [a, b, tip],
  [a, tip, c],
  [c, tip, b],
]

// Origami crane facing +z, wingspan about 2.2 units. Wings are separate meshes so they can flap.
const crane = () => {
  const nose: Point = [0, 0.04, 0.46]
  const tail: Point = [0, 0.06, -0.42]
  const top: Point = [0, 0.12, 0.02]
  const keel: Point = [0, -0.17, 0]
  const left: Point = [-0.14, -0.02, 0]
  const right: Point = [0.14, -0.02, 0]
  const head: Point = [0, 0.38, 0.8]
  return folded([
    [nose, top, left],
    [nose, left, keel],
    [nose, keel, right],
    [nose, right, top],
    [tail, left, top],
    [tail, keel, left],
    [tail, right, keel],
    [tail, top, right],
    ...spike([-0.06, 0.04, 0.3], [0.06, 0.04, 0.3], [0, -0.06, 0.44], head),
    [head, [-0.035, 0.33, 0.78], [0, 0.24, 0.98]],
    [head, [0, 0.24, 0.98], [0.035, 0.33, 0.78]],
    ...spike([-0.06, 0.06, -0.28], [0.06, 0.06, -0.28], [0, -0.04, -0.42], [0, 0.38, -0.9]),
  ])
}
const wing = (side: 1 | -1) =>
  folded([
    [
      [0, 0.06, 0.3],
      [side * 0.52, 0.12, 0.18],
      [0, 0.06, -0.28],
    ],
    [
      [0, 0.06, -0.28],
      [side * 0.52, 0.12, 0.18],
      [side * 1.12, 0.06, -0.32],
    ],
  ])

// Where the dawn sun ends up on screen, as viewport fractions from the centre, y up.
const SUN_AT = [0.335, 0.2] as const
// Depth of the scene's sky. Birds must vanish before reaching it.
const SKY_Z = -2600
const SUN = new Vector3(0.3, 0.18, -0.94).normalize()

interface Bird {
  readonly body: Group
  readonly left: Mesh
  readonly right: Mesh
  /** Cubic Bezier control points in viewport px. */
  readonly path: readonly [Vector3, Vector3, Vector3, Vector3]
  readonly delay: number
  readonly duration: number
  phase: number
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function bezier([a, b, c, d]: Bird['path'], s: number, out: Vector3): Vector3 {
  const r = 1 - s
  return out
    .copy(a)
    .multiplyScalar(r * r * r)
    .addScaledVector(b, 3 * r * r * s)
    .addScaledVector(c, 3 * r * s * s)
    .addScaledVector(d, s * s * s)
}

// Alternates between the two halves of the line (0, 4, 1, 5 and so on for seven birds), so
// neighbours never launch back to back.
const laneOf = (i: number, n: number): number => (i % 2 ? Math.ceil(n / 2) + (i - 1) / 2 : i / 2)

/** Point at depth z that projects to the given viewport fractions. */
function at(x: number, y: number, z: number): Vector3 {
  const s = (D - z) / D
  return new Vector3(x * window.innerWidth * s, y * window.innerHeight * s, z)
}

// At the end of the page a flock of paper cranes takes off from below the bottom-left corner and
// flies into the sun. Scrolling back up and down again sends a new flock.
export default effect(
  { count: 7, span: 80, paper: '#f6dcc0', haze: '#f0a98f' },
  { animate: 'visible', reducedMotion: 'off' },
  ({ viewport, u, params, onDispose }) => {
    // Back-facing paper picks up warm light shining through it.
    const facing = dot(normalWorldGeometry.mul(faceDirection), vec3(SUN.x, SUN.y, SUN.z))
    const lit = clamp(facing.mul(0.6).add(0.55), 0, 1)
    const paper = mix(vec3(0.5, 0.3, 0.33), vec3(1, 1, 1), lit)
      .mul(u.paper)
      .add(WARM.mul(max(facing.negate(), 0).mul(0.28)))
    const far = smoothstep(1300, 3600, positionView.z.negate())
    // The sky and ridges don't write depth, so drawing after them keeps the flock in front of the
    // hills. depthWrite still sorts the birds among themselves.
    const material = new MeshBasicNodeMaterial({
      side: DoubleSide,
      transparent: true,
      depthWrite: true,
    })
    material.colorNode = vec4(mix(paper, u.haze, far.mul(0.85)), 1)
    const body = crane()
    const wings = [wing(-1), wing(1)] as const
    onDispose(() => {
      material.dispose()
      body.dispose()
      for (const w of wings) w.dispose()
    })

    const flock = new Group()
    viewport.add(flock)
    let birds: Bird[] = []
    let state: 'ready' | 'flying' | 'done' = 'ready'
    let clock = 0

    const launch = (): void => {
      flock.clear()
      const r = Math.random
      const n = Math.max(1, Math.round(params.count))
      birds = Array.from({ length: n }, (_, i) => {
        // Lanes keep the same left-to-right order at both ends, so paths never cross.
        const lane = laneOf(i, n)
        const k = n > 1 ? lane / (n - 1) : 0.5
        // Close enough to look big, not so close they loom.
        const z0 = 40 + r() * 160
        const x0 = -0.44 + k * 0.46 + (r() - 0.5) * 0.03
        const y0 = -0.62 - r() * 0.06
        const z3 = SKY_Z + 200 + r() * 200
        const x3 = SUN_AT[0] + (k - 0.5) * 0.26
        const y3 = SUN_AT[1] + (lane % 2 ? 0.05 : -0.05) + (r() - 0.5) * 0.03
        const left = new Mesh(wings[0], material)
        const right = new Mesh(wings[1], material)
        const bird = new Group()
        bird.add(new Mesh(body, material), left, right)
        bird.visible = false
        for (const part of bird.children) {
          part.frustumCulled = false
          part.renderOrder = 2
        }
        flock.add(bird)
        return {
          body: bird,
          left,
          right,
          path: [
            at(x0, y0, z0),
            at(x0 + 0.06, y0 + 0.4, z0 - 520),
            at(x3 - 0.05, y3 + 0.08, z3 + 800),
            at(x3, y3, z3),
          ],
          delay: i * 0.4 + r() * 0.08,
          duration: 7 + r() * 1.5,
          phase: r() * Math.PI * 2,
        }
      })
      clock = 0
      state = 'flying'
    }

    const here = new Vector3()
    const ahead = new Vector3()
    const turn = new Matrix4()
    const roll = new Quaternion()
    const Z = new Vector3(0, 0, 1)
    const UP = new Vector3(0, 1, 0)

    return ({ y, height, delta }) => {
      // 1 at the very end of the page.
      const seen = (window.innerHeight - y) / Math.max(1, height)
      if (state === 'ready' && seen > 0.9) launch()
      else if (state === 'done' && seen < 0.5) state = 'ready'
      else if (state === 'flying' && seen < 0.1) {
        flock.clear()
        state = 'ready'
      }
      if (state !== 'flying') return
      clock += delta
      let waiting = false
      let flying = false
      for (const [i, bird] of birds.entries()) {
        const t = (clock - bird.delay) / bird.duration
        bird.body.visible = t > 0 && t < 1
        if (t <= 0) waiting = true
        if (!bird.body.visible) continue
        flying = true
        // Fast flaps at take-off, slower and shallower once aloft.
        const aloft = smooth(0.05, 0.4, t)
        bird.phase += delta * Math.PI * 2 * (3.4 - 1.6 * aloft)
        const beat = Math.sin(bird.phase)
        const lift = (0.95 - 0.4 * aloft) * beat + 0.18
        bird.left.rotation.z = -lift
        bird.right.rotation.z = lift
        const s = 1 - (1 - t) ** 1.25
        bezier(bird.path, s, here)
        bezier(bird.path, Math.min(1, s + 0.01), ahead)
        if (ahead.distanceToSquared(here) < 1e-6) ahead.copy(here).add(Z)
        // Matrix4.lookAt(eye = ahead, target = here) points +z along the path.
        turn.lookAt(ahead, here, UP)
        bird.body.quaternion
          .setFromRotationMatrix(turn)
          .multiply(roll.setFromAxisAngle(Z, Math.sin(bird.phase * 0.5 + i) * 0.14))
        bird.body.position.copy(here)
        bird.body.position.y -= beat * 0.05 * params.span
        bird.body.scale.setScalar(params.span * (1 - smooth(0.86, 1, t)))
      }
      if (!flying && !waiting) {
        flock.clear()
        state = 'done'
      }
    }
  },
)
