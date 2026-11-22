import type { QualityTier } from '@dioramajs/diorama/quality'
import { app } from '../../../docs/diorama.ts'
import { running } from '../replay.ts'

// The count caps of confetti by tier, from its quality spec; high has none.
const CAPS: Record<QualityTier, number> = {
  low: 80,
  medium: 140,
  high: 200,
}

// Tier buttons pin the site's tier with app.quality.set() and fire a burst at it; leaving the
// page hands the tier back to detection.
export default function mount(example: HTMLElement): () => void {
  const cannon = example.querySelector('.q-cannon')
  const buttons = [
    ...example.querySelectorAll<HTMLButtonElement>('[data-tier]'),
  ]
  const fire = example.querySelector<HTMLButtonElement>('[data-replay]')
  const readout = example.querySelector('[data-readout]')
  if (!cannon || !readout) return () => {}
  let pinned = false
  let off = () => {}
  const show = () => {
    if (!app.has('quality')) return
    const { tier, reason, gpu } = app.quality
    const now = tier.value
    readout.textContent = `${now} (${reason.value}, ${gpu.class} GPU): at most ${CAPS[now]} of 200 pieces`
    for (const b of buttons)
      b.setAttribute(
        'aria-pressed',
        String(b.dataset.tier === (pinned ? now : 'auto')),
      )
  }
  const burst = () => {
    const confetti = app.effects.get(cannon, 'confetti')
    if (confetti) confetti.params.fire++
  }
  const onClick = (e: MouseEvent) => {
    const button = (e.target as Element).closest<HTMLButtonElement>(
      '[data-tier]',
    )
    if (!button || !app.has('quality')) return
    const tier = (button.dataset.tier ?? 'auto') as QualityTier | 'auto'
    pinned = tier !== 'auto'
    app.quality.set(tier)
    show()
    burst()
  }
  example.addEventListener('click', onClick)
  fire?.addEventListener('click', burst)
  void running(cannon, 'confetti').then((ok) => {
    if (!ok || !example.isConnected) return
    off = app.on('quality:tier', show)
    show()
  })
  return () => {
    off()
    if (pinned && app.has('quality')) app.quality.set('auto')
    example.removeEventListener('click', onClick)
    fire?.removeEventListener('click', burst)
  }
}
