import { effect } from 'diorama'
import { texture, uniform, uv, vec3, vec4 } from 'three/tsl'
import type { Node, Texture } from 'three/webgpu'
import {
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
} from 'three/webgpu'
import { arrived, DEPTH, hero, inScene, nearFade } from './_hero'
import { glare, glareAt, WARM } from './_look'

// Ridge paper colours, front to back.
const SHEETS = ['#e2a18c', '#c98a80', '#a85c58', '#86393b'] as const
const GAP = 13

// The heading as a layer in the scene, drawn from the browser's own text layout. The `.deep` line
// gets extra paper layers behind it that spread apart in depth once the scene arrives. The DOM
// heading stays real text for selection, search and screen readers.
export default effect(
  {},
  { animate: 'visible' },
  async ({ element, place, mask, layer, pose, signal }) => {
    await document.fonts.ready
    if (signal.aborted) return
    const host = element as HTMLElement
    const deep = host.querySelector<HTMLElement>('.deep')

    const allCanvas = document.createElement('canvas')
    const deepCanvas = document.createElement('canvas')
    const allInk = new CanvasTexture(allCanvas)
    const deepInk = new CanvasTexture(deepCanvas)
    const paint = (): void => {
      const box = host.getBoundingClientRect()
      const scale = Math.min(2, window.devicePixelRatio || 1)
      const width = Math.max(1, Math.round(box.width * scale))
      const height = Math.max(1, Math.round(box.height * scale))
      // three uploads a resized canvas into the old GPU texture and crops it. Disposing forces
      // a new texture at the new size.
      if (allCanvas.width !== width || allCanvas.height !== height) {
        allInk.dispose()
        deepInk.dispose()
      }
      for (const canvas of [allCanvas, deepCanvas]) {
        canvas.width = width
        canvas.height = height
      }
      for (const line of host.querySelectorAll<HTMLElement>('.line')) {
        const style = getComputedStyle(line)
        const r = line.getBoundingClientRect()
        for (const canvas of line === deep ? [allCanvas, deepCanvas] : [allCanvas]) {
          const g = canvas.getContext('2d') as CanvasRenderingContext2D
          g.setTransform(scale, 0, 0, scale, 0, 0)
          g.fillStyle = '#fff'
          g.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
          g.fontStretch = 'semi-expanded'
          g.letterSpacing = style.letterSpacing
          g.textBaseline = 'alphabetic'
          const text = line.textContent ?? ''
          const m = g.measureText(text)
          g.fillText(
            text,
            r.left - box.left,
            r.top - box.top + (r.height + m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2,
          )
        }
      }
      allInk.needsUpdate = true
      deepInk.needsUpdate = true
    }
    paint()
    const resize = new ResizeObserver(paint)
    resize.observe(host)
    signal.addEventListener('abort', () => {
      resize.disconnect()
      allInk.dispose()
      deepInk.dispose()
    })

    // Same glare as the photo.
    const p = uv()
    const at = uniform(0.45)
    const light = WARM.mul(glare(p, at).mul(0.08))
    const sheet = (ink: Texture, tone: Node<'vec3'>): Mesh => {
      const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
      material.colorNode = vec4(tone.add(light), 1)
      material.opacityNode = texture(ink, p).a.mul(mask())
      return new Mesh(new PlaneGeometry(1, 1), material)
    }
    const tone = (css: string): Node<'vec3'> => {
      const c = new Color(css)
      return vec3(c.r, c.g, c.b)
    }

    const heading = new Group()
    heading.add(sheet(allInk, tone(getComputedStyle(host).color)))
    const behind = SHEETS.map((css) => {
      const mesh = sheet(deepInk, tone(css))
      heading.add(mesh)
      return mesh
    })
    place(heading, { replace: true })

    return (input) => {
      at.value = glareAt()
      const open = arrived(1500, 500)
      for (const [i, mesh] of behind.entries()) mesh.position.z = -GAP * (i + 1) * open
      // Hidden once the camera has flown past it.
      heading.visible = nearFade(DEPTH.title, hero.flight) > 0
      pose(layer, inScene(input, DEPTH.title, hero.flight), 1)
    }
  },
)
