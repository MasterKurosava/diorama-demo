import type { EffectContext } from 'dioramajs'
import { exp, sin, vec2 } from 'three/tsl'

export const params = { strength: 1, frequency: 40, speed: 6 }

// The setup of the built-in ripple, unchanged.
export function setup({
  surface,
  u,
}: EffectContext<typeof params>): void {
  surface.uv((uv) => {
    const toPointer = uv.sub(u.pointer)
    const d = toPointer.length()
    const phase = d.mul(u.frequency).sub(u.hoverTime.mul(u.speed))
    const wave = sin(phase).mul(
      exp(d.mul(-8)),
      u.hover,
      u.strength,
      0.012,
    )
    return uv.add(toPointer.add(vec2(1e-5, 0)).normalize().mul(wave))
  })
}
