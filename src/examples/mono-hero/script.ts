import { app } from '../../docs/diorama.ts'

export default (example: HTMLElement) => {
  const hero = example.querySelector('.hero')
  const instance = hero && app.effects.get(hero, 'mono')
  if (instance) instance.params.strength = 0.3
}
