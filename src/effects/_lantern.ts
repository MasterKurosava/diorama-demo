// State shared across lantern instances: the paper fibre texture and the motion that copies
// with the same `data-dio-key` share.

import type { EffectContext } from 'dioramajs'
import { CanvasTexture, Color, NoColorSpace, RepeatWrapping, Vector3 } from 'three/webgpu'

function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let painted: CanvasTexture | undefined

/** Backlit washi: pulp clouds and long fibres, tiling, centred on mid grey. Painted once. */
export function fibres(): CanvasTexture {
  if (painted) return painted
  const S = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = S
  const g = canvas.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = 'rgb(128,128,128)'
  g.fillRect(0, 0, S, S)
  const rand = random(11)
  // Draw into all nine neighbouring tiles so it wraps without a seam.
  const tiled = (draw: (dx: number, dy: number) => void) => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) draw(dx, dy)
  }
  for (let i = 0; i < 90; i++) {
    const x = rand() * S
    const y = rand() * S
    const r = 10 + rand() * 46
    const light = rand() < 0.5
    const a = 0.05 + rand() * 0.09
    tiled((dx, dy) => {
      const blob = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r)
      blob.addColorStop(0, light ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`)
      blob.addColorStop(1, 'rgba(128,128,128,0)')
      g.fillStyle = blob
      g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r)
    })
  }
  g.lineCap = 'round'
  for (let i = 0; i < 320; i++) {
    const x = rand() * S
    const y = rand() * S
    const angle = rand() * Math.PI * 2
    const length = 8 + rand() * 38
    const bend = (rand() - 0.5) * length * 0.8
    const ex = x + Math.cos(angle) * length
    const ey = y + Math.sin(angle) * length
    const mx = (x + ex) / 2 - Math.sin(angle) * bend
    const my = (y + ey) / 2 + Math.cos(angle) * bend
    const light = rand() < 0.7
    g.strokeStyle = light
      ? `rgba(255,255,255,${0.12 + rand() * 0.2})`
      : `rgba(0,0,0,${0.08 + rand() * 0.12})`
    g.lineWidth = 0.6 + rand() * 1.1
    tiled((dx, dy) => {
      g.beginPath()
      g.moveTo(x + dx, y + dy)
      g.quadraticCurveTo(mx + dx, my + dy, ex + dx, ey + dy)
      g.stroke()
    })
  }
  const texture = new CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.colorSpace = NoColorSpace
  // Shared by every lantern, so instance disposal must skip it.
  texture.userData.keep = true
  painted = texture
  return texture
}

const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** 1D value noise in 0..1. */
export function flicker(x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return hash(i) * (1 - u) + hash(i + 1) * u
}

/** Two angles in radians and their velocities. */
export interface Swing {
  x: number
  z: number
  vx: number
  vz: number
}

export interface Motion {
  /** Last frame stepped, so shared motion advances once per frame however many copies there are. */
  frame: number
  /** Frozen under reduced motion. */
  t: number
  /** Goes 0 to 1 the first time the lantern is seen. */
  lit: number
  flame: number
  hover: number
  readonly flameAt: Vector3
  /** The sway is relative to the pivot. The tassel's is in world space because it hangs plumb. */
  readonly sway: Swing
  readonly tassel: Swing
  yaw: number
  readonly tint: Color
  readonly goal: Color
  css: string
  /** Box centre in px and its smoothed velocity. A flight makes the lantern swing. */
  cx: number | undefined
  vx: number
  pointer: { x: number; y: number } | undefined
  /** Keeps requesting frames while easing, even with motion off. */
  settling: boolean
}

export interface Member {
  readonly element: Element
  readonly input: EffectContext['input']
}

interface Shared {
  readonly motion: Motion
  readonly members: Set<Member>
}

export interface Twin extends Shared {
  /** Drops the shared motion once its last copy leaves. */
  readonly leave: () => void
}

const twins = new Map<string, Shared>()

/**
 * Copies with the same key share one motion, so the lantern leaving the old page and the one
 * landing on the new page keep the same swing.
 */
export function twin(key: string | null, member: Member, tint: string): Twin {
  let shared = key ? twins.get(key) : undefined
  if (!shared) {
    shared = {
      motion: {
        frame: -1,
        t: Math.random() * 100,
        lit: 0,
        flame: 1,
        hover: 0,
        flameAt: new Vector3(),
        sway: { x: 0, z: 0, vx: 0, vz: 0 },
        tassel: { x: 0, z: 0, vx: 0, vz: 0 },
        yaw: Number.NaN,
        tint: new Color(tint),
        goal: new Color(tint),
        css: tint,
        cx: undefined,
        vx: 0,
        pointer: undefined,
        settling: true,
      },
      members: new Set(),
    }
    if (key) twins.set(key, shared)
  }
  const { motion, members } = shared
  members.add(member)
  return {
    motion,
    members,
    leave: () => {
      members.delete(member)
      if (key && !members.size && twins.get(key) === shared) twins.delete(key)
    },
  }
}
