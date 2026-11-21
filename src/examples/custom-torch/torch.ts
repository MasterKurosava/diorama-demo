import { effect } from 'dioramajs'
import { smoothstep, vec2, vec4 } from 'three/tsl'

export default effect(
  { radius: 0.35, strength: 0.6, tint: '#ffd27a' },
  ({ surface, u }) => {
    const aspect = vec2(u.size.x.div(u.size.y), 1)
    surface.color((color, { uv }) => {
      const distance = uv.sub(u.pointer).mul(aspect).length()
      const edge = smoothstep(0, u.radius, distance)
      const light = edge.oneMinus().mul(u.hover, u.strength)
      return vec4(color.rgb.add(u.tint.mul(light)), color.a)
    })
  },
)
