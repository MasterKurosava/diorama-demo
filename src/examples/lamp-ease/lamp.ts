import { effect } from 'dioramajs'
import { approach, chase } from 'dioramajs/kit'
import { mix, smoothstep, uniform, vec3, vec4 } from 'three/tsl'
import { Vector2 } from 'three/webgpu'

// Seconds to cover most of the way to the pointer, and of a fade.
const LAG = 0.12
const FADE = 0.3

export default effect(
  { radius: 160, dim: 0.5, strength: 1.5, color: '#fff1dc' },
  ({ surface, u }) => {
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

    const aim = { x: 0, y: 0 }
    return (input) => {
      aim.x = input.pointer.x * input.width
      aim.y = input.pointer.y * input.height
      const target = input.over ? 1 : 0
      // Off, the lamp jumps to the pointer instead of sliding in.
      const lag = on.value === 0 ? 0 : LAG
      const moving = chase(at.value, aim, lag, input.delta, 0.5)
      on.value = approach(on.value, target, input.delta / FADE)
      // true asks for the next frame, until the lamp settles.
      return moving || on.value !== target
    }
  },
)
