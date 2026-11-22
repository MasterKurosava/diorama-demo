import { effect } from '@dioramajs/diorama'
import { Mesh, MeshBasicNodeMaterial, RingGeometry } from 'three/webgpu'

export default effect(
  { speed: 1, color: '#ffd27a' },
  ({ place, params, u }) => {
    const material = new MeshBasicNodeMaterial({ transparent: true })
    material.colorNode = u.color
    // Three quarters of a ring, so the turn shows.
    const geometry = new RingGeometry(
      0.46,
      0.5,
      64,
      1,
      0,
      Math.PI * 1.5,
    )
    const ring = place(new Mesh(geometry, material))
    return (input) => {
      ring.rotation.z = input.time * params.speed
    }
  },
)
