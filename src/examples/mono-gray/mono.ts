import { effect } from 'dioramajs'
import { luminance, mix, vec3, vec4 } from 'three/tsl'

export default effect({ strength: 1 }, ({ surface, u }) => {
  surface.color((color) => {
    const gray = vec3(luminance(color.rgb))
    return vec4(mix(color.rgb, gray, u.strength), color.a)
  })
})
