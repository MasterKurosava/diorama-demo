import { effect } from 'dioramajs'

export default effect({ strength: 1 }, ({ surface, u }) => {
  surface.color((color) => color.mul(u.strength.add(1)))
})
