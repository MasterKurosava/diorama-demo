// Stands in for the reactions channel of a stream: other viewers react now and then, and every
// message becomes one event on the bar. A tap on a reaction goes the same way, three of it.
export default function mount(example: HTMLElement): () => void {
  const feed = example.querySelector<HTMLElement>('.ej-picks')
  if (!feed) return () => {}
  const react = (emoji: string, count: number) =>
    feed.dispatchEvent(
      new CustomEvent('reaction', { detail: { emoji, count } }),
    )
  const onPick = (e: Event) => {
    const emoji = (e.target as Element).closest<HTMLElement>(
      '[data-react]',
    )?.dataset.react
    if (emoji) react(emoji, 3)
  }
  const others = ['👍', '❤️', '❤️', '😂', '😮']
  const timer = window.setInterval(() => {
    react(others[Math.floor(Math.random() * others.length)] ?? '❤️', 1)
  }, 700)
  feed.addEventListener('click', onPick)
  return () => {
    clearInterval(timer)
    feed.removeEventListener('click', onPick)
  }
}
