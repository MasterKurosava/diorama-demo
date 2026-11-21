import { effect } from 'dioramajs'

export default effect(
  { src: '' },
  { presence: 'custom' },
  async ({ params, model, viewport, app }) => {
    const lantern = await model(params.src)
    viewport.add(lantern)
    return ({ pin }) => {
      const size =
        Math.min(app.stage.width.value, app.stage.height.value) * 0.6
      lantern.scale.setScalar(size)
      lantern.rotation.y = pin * Math.PI * 2
      lantern.position.y = (0.5 - pin) * 80
    }
  },
)
