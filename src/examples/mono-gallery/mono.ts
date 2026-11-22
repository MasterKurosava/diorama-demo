import { effect } from '@dioramajs/diorama'
import { luminance, mix, vec3, vec4 } from 'three/tsl'

export default effect(
  { strength: 1, ink: '#1d2b53' },
  ({ surface, u }) => {
    surface.color((color) => {
      const gray = luminance(color.rgb)
      const toned = mix(u.ink, vec3(1), gray)
      return vec4(mix(color.rgb, toned, u.strength), color.a)
    })
  },
)
