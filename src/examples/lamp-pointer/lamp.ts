import { effect } from '@dioramajs/diorama'
import { mix, smoothstep, vec3, vec4 } from 'three/tsl'

export default effect(
  { radius: 160, dim: 0.5, strength: 1.5, color: '#fff1dc' },
  ({ surface, u }) => {
    surface.color((color, { box }) => {
      // Distance to the pointer in CSS px, so the light stays round.
      const distance = box.sub(u.pointer).mul(u.size).length()
      const lit = smoothstep(0, u.radius, distance).oneMinus()
      // The rest of the photo dims, the lamp lights in its color.
      const lamp = u.color.mul(u.strength)
      const light = mix(vec3(u.dim.oneMinus()), lamp, lit)
      return vec4(color.rgb.mul(mix(vec3(1), light, u.hover)), color.a)
    })
  },
)
