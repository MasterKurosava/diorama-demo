import { effect } from '@dioramajs/diorama'
import { smoothstep, vec4 } from 'three/tsl'

export default effect({ radius: 0.35, dim: 0.6 }, ({ surface, u }) => {
  surface.color((color, { box }) => {
    const d = box.sub(u.pointer).mul(u.size).length().div(u.size.y)
    const spot = smoothstep(u.radius.mul(0.6), u.radius, d).oneMinus()
    const shade = spot.oneMinus().mul(u.dim, u.hover).oneMinus()
    return vec4(color.rgb.mul(shade), color.a)
  })
})
