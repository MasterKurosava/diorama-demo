import { effect } from 'dioramajs'
import { mix, smoothstep, vec4 } from 'three/tsl'
import { wet, wetPaper } from './_ink'

// Ink bleeding into wet paper from the pointer and a few random drops. Dried ink leaves the image.
export default effect(
  { color: '#3d0a14', spread: 0.6, speed: 1 },
  { media: true, animate: wet }, // only redraws while some ink is still wet
  (ctx) => {
    const paper = wetPaper(ctx)
    ctx.surface.color((_, { uv }) => {
      const age = paper.age(uv) // seconds since the ink arrived
      const dry = smoothstep(0, ctx.u.spread, age) // bleeds, then settles
      const wash = paper.dark(uv, dry.oneMinus().mul(4)) // blurry while wet
      const ink = paper.tide(uv, wash.mul(mix(0.3, 1, dry))) // plus tide lines
      const sheet = paper.sheet(uv, age)
      // Ink is a filter: transmittance raised to the ink density.
      const tint = ctx.u.color.rgb.div(sheet).max(0.02)
      return vec4(sheet.mul(tint.pow(ink.mul(paper.reached(uv)))), 1)
    })
    return (input) => paper.flow(input.delta * ctx.params.speed)
  },
)
