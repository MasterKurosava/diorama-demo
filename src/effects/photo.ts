import { effect } from 'diorama'
import { color, mix, smoothstep, uniform, vec4 } from 'three/tsl'
import { D, DEPTH, hero, inScene, LANDED, smooth, touchable } from './_hero'
import { arch, glare, glareAt, paperSurface, WARM } from './_look'

/** Same as the valley mist at dusk. */
const MIST = color('#e2a18c')

// The big photo far back among the ridges, an arch cut from the scene's papers. The sun's glare
// slides across it as the eye turns and the pointer sends rings through it. The hero flight ends
// on it: the hills in front go down, the arch opens and it fills the frame of the landing card.
export default effect({ rings: 1 }, { media: true, animate: 'visible' }, (ctx) => {
  const { surface, u, layer, pose } = ctx
  const at = uniform(0.45)
  const touch = uniform(1)
  const open = uniform(0)
  // Hidden once the card takes over, so a copy left behind by a page change doesn't reappear.
  const shown = uniform(1)

  paperSurface(ctx, u.rings.mul(touch))
  surface.color((color, { box }) => {
    // No glare in the frame, where it has to match the card's picture exactly.
    const sun = WARM.mul(glare(box, at).mul(open.oneMinus().mul(0.22))).add(1)
    const shape = arch(box, u.size, open)
    const rim = shape.rim.mul(0.3).add(1)
    // Foot in the valley mist like the ridges, clear once in the frame.
    const mist = smoothstep(0.34, 0, box.y).mul(open.oneMinus(), 0.85)
    const rgb = mix(color.rgb.mul(sun, rim), MIST, mist)
    return vec4(rgb, color.a.mul(shape.inside, shown))
  })

  const landing = document.querySelector<HTMLElement>('.landing')
  return (input) => {
    at.value = glareAt()
    const f = hero.flight
    touch.value = touchable(f)
    const from = inScene(input, DEPTH.photo, f)
    open.value = hero.reduced ? (f > 0.5 ? 1 : 0) : smooth(0.7, 0.97, f)
    // Snap to the frame at the end so the hand-over to the card is exact.
    const k = hero.reduced ? (f > 0.5 ? 1 : 0) : smooth(0.88, 0.97, f)
    shown.value = f > LANDED ? 0 : 1
    // A transparent copy left behind in a page change would otherwise cut a hole in the picture
    // flying over it.
    surface.material.depthWrite = false
    if (!landing || k === 0) {
      pose(layer, from, 1)
      return
    }
    // The card sits at z = 0 with its shadow box opening behind. Keep the photo slightly in
    // front until the hand-over and behind the whole box after, at the same screen size. Two
    // pictures at one depth z-fight, and the hidden one cuts holes in the other.
    const r = landing.getBoundingClientRect()
    const z = hero.card ? -140 : 4
    const s = (D - z) / D
    const to = {
      x: (r.left + r.width / 2 - window.innerWidth / 2) * s,
      y: (window.innerHeight / 2 - (r.top + r.height / 2)) * s,
      z,
      width: r.width * s,
      height: r.height * s,
    }
    const mix = (a: number, b: number) => a + (b - a) * k
    pose(
      layer,
      {
        x: mix(from.x, to.x),
        y: mix(from.y, to.y),
        z: mix(from.z, to.z),
        width: mix(from.width, to.width),
        height: mix(from.height, to.height),
      },
      1,
    )
  }
})
