import { effect } from 'dioramajs'

export default effect(
  { src: '' },
  { presence: 'custom' },
  async ({ params, model, place }) => {
    const lantern = await model(params.src)
    place(lantern, { fit: 'contain', replace: true })
  },
)
