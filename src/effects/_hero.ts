// Hero state. The page script writes it and the effects read it, so no three.js here.
// Files starting with `_` are not effects.

export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Camera distance in px, the render plugin's default. Something at depth z has to be (D - z) / D
 * times larger to keep its screen size.
 */
export const D = 1000
/** The eye turns around this depth, the middle of the scene. */
export const PIVOT = -520
/** Flight value at which the picture has landed and the card in the frame takes over. */
export const LANDED = 0.97

/** Scene depth of each piece. More negative is further back. */
export const DEPTH = {
  photo: -1250,
  title: -250,
  portrait: -380,
  metal: 60,
} as const

export const hero = {
  /** -0.5..0.5 of the viewport, and whether it has moved yet. */
  pointer: { x: 0, y: 0, moved: false },
  /** Eye turn in radians, eased by the scene. */
  view: { yaw: 0, pitch: 0 },
  /** Scroll progress through the hero, 0..1, which drives the fly-in. */
  flight: 0,
  /**
   * Eye travel over the whole flight in world px. It ends square in front of the photograph, which
   * then fills the hero's last frame. Set by the page through `aimAt`.
   */
  aim: { x: 0, y: 0, z: 1300 },
  /** With reduced motion the eye stays put and the flight is a cut. */
  reduced: false,
  /** performance.now() when the scene began to arrive, 0 while the page is loading. */
  start: 0,
  /** The card in the frame has taken over from the landed picture. */
  card: false,
  /** How far the card's shadow box has opened, 0..1. */
  parted: 0,
}

/** Arrival progress 0..1 over `ms`. Instant with reduced motion. */
export const arrived = (ms = 1600, delay = 0): number => {
  if (!hero.start) return 0
  return hero.reduced ? 1 : smooth(0, 1, (performance.now() - hero.start - delay) / ms)
}

export const clamp = (x: number, a = 0, b = 1): number => Math.min(b, Math.max(a, x))
export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/**
 * Eye offset at flight f in world px. Eased in so the first scroll only nudges it. The scene
 * moves the other way.
 */
export function eye(f: number): { x: number; y: number; z: number } {
  const k = hero.reduced ? 0 : f * f
  return { x: hero.aim.x * k, y: hero.aim.y * k, z: hero.aim.z * k }
}
export const ahead = (f: number): number => eye(f).z
/**
 * How far the hills in front of the photograph have sunk, 0..1. They drop like stage flats as the
 * eye gets close, so the picture stands clear in its frame.
 */
export const sunk = (f: number): number => (hero.reduced ? (f > 0.5 ? 1 : 0) : smooth(0.7, 0.97, f))

/**
 * Aims the flight so the photograph lands exactly in the frame. Boxes are viewport px measured in
 * the same frame. `pin` is the hero's screen, so the aim still holds after the page scrolls on.
 */
export function aimAt(photo: Box, frame: Box, pin: Box): void {
  const s = (D - DEPTH.photo) / D
  const z = D * (1 - (photo.width * s) / Math.max(1, frame.width))
  const k = (D - z) / D
  const cx = (b: Box) => b.x - pin.x + b.width / 2 - window.innerWidth / 2
  const cy = (b: Box) => window.innerHeight / 2 - (b.y - pin.y + b.height / 2)
  hero.aim.x = cx(photo) * s - cx(frame) * k
  hero.aim.y = cy(photo) * s - cy(frame) * k
  hero.aim.z = z - DEPTH.photo
}

/**
 * How much the pieces still react to the pointer. Their hit boxes stay put in the page while the
 * eye flies, so the reaction fades out early in the flight.
 */
export const touchable = (f: number): number => 1 - smooth(0.01, 0.08, f)

/** Opacity of something at depth z during the fly-in. Gone before the eye reaches it. */
export const nearFade = (z: number, f: number): number => smooth(D - 450, D - 650, z + ahead(f))

/**
 * Puts a laid-out box at depth z without moving it on screen. At rest it covers its own box
 * exactly and only an eye turn reveals the depth. The flight carries it nearer like the rest.
 */
export function inScene(box: Box, z: number, f: number) {
  const s = (D - z) / D
  const cx = box.x + box.width / 2 - window.innerWidth / 2
  const cy = window.innerHeight / 2 - (box.y + box.height / 2)
  const e = eye(f)
  return {
    x: cx * s - e.x,
    y: cy * s - e.y,
    z: z + e.z,
    width: box.width * s,
    height: box.height * s,
  }
}

/**
 * Screen position of a point at depth z, turned with the eye round the pivot and moved by the
 * flight. Input and output are px from the viewport centre, y up.
 */
export function seen(x: number, y: number, z: number): { x: number; y: number } {
  const s = (D - z) / D
  const e = eye(hero.flight)
  const px = x * s - e.x
  const py = y * s - e.y
  const pz = z + e.z - PIVOT
  const { yaw, pitch } = hero.view
  // Yaw about y, then pitch about x, matching three's 'XYZ' order.
  const x1 = px * Math.cos(yaw) + pz * Math.sin(yaw)
  const z1 = -px * Math.sin(yaw) + pz * Math.cos(yaw)
  const y2 = py * Math.cos(pitch) - z1 * Math.sin(pitch)
  const z2 = py * Math.sin(pitch) + z1 * Math.cos(pitch) + PIVOT
  const k = D / (D - z2)
  return { x: x1 * k, y: y2 * k }
}
