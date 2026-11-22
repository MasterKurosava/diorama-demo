import { effect } from '@dioramajs/diorama'
import { approach, chase, follow } from '@dioramajs/diorama/kit'
import { mix, smoothstep, uniform, vec3, vec4 } from 'three/tsl'
import { Vector2 } from 'three/webgpu'

// Seconds to cover most of the way to the pointer, and of a fade.
const LAG = 0.12
const FADE = 0.3

export default effect(
  { radius: 160, dim: 0.5, strength: 1.5, color: '#fff1dc' },
  (ctx) => {
    const { surface, u } = ctx
    // The lamp in CSS px from the bottom left, and how far it is on.
    const at = uniform(new Vector2())
    const on = uniform(0)
    surface.color((color, { box }) => {
      const distance = box.mul(u.size).sub(at).length()
      const lit = smoothstep(0, u.radius, distance).oneMinus()
      const lamp = u.color.mul(u.strength)
      const light = mix(vec3(u.dim.oneMinus()), lamp, lit)
      return vec4(color.rgb.mul(mix(vec3(1), light, on)), color.a)
    })

    // A mouse over the photo or a finger pressed on it.
    const pointer = follow(ctx)
    return (input) => {
      const target = pointer.over ? 1 : 0
      // Off, or under reduced motion, the lamp jumps to the pointer.
      const still = input.reducedMotion
      const lag = still || on.value === 0 ? 0 : LAG
      const aim = pointer.box(input)
      const moving = chase(at.value, aim, lag, input.delta, 0.5)
      const step = still ? 1 : input.delta / FADE
      on.value = approach(on.value, target, step)
      // true asks for the next frame, until the lamp settles.
      return moving || on.value !== target
    }
  },
)
