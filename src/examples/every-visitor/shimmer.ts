import { effect } from 'dioramajs'
import { fract, smoothstep, vec4 } from 'three/tsl'

export default effect(
  { speed: 0.25, width: 0.15 },
  { reducedMotion: 'off' },
  ({ surface, u }) => {
    surface.color((color, { box }) => {
      const at = fract(u.time.mul(u.speed)).mul(2).sub(0.5)
      const d = box.x.add(box.y).mul(0.5).sub(at).abs()
      const band = smoothstep(0, u.width, d).oneMinus().mul(0.35)
      return vec4(color.rgb.add(band), color.a)
    })
  },
)
