import { app } from '../../docs/diorama.ts'

const CELLS = 120

// Controls of the frame tape. Each policy is its own effect file with the same setup, so a
// button swaps the token in data-dio. Reduced motion and the hidden tab are emulated for the
// whole docs page while the example is on it.
export default (example: HTMLElement) => {
  const img = example.querySelector('.ex-root img')
  const tape = example.querySelector<HTMLElement>('.tape')
  const meter = example.querySelector('.frames')
  const off: (() => void)[] = []
  const on = (
    el: Element | null,
    type: string,
    listener: (event: Event) => void,
  ) => {
    el?.addEventListener(type, listener)
    off.push(() => el?.removeEventListener(type, listener))
  }

  const prefix = (img?.getAttribute('data-dio') ?? '').replace(
    /hover(-v\d+)?$/,
    '',
  )
  for (const button of example.querySelectorAll<HTMLButtonElement>(
    '[data-policy]',
  )) {
    on(button, 'click', () => {
      const suffix =
        img?.getAttribute('data-dio')?.match(/-v\d+$/)?.[0] ?? ''
      img?.setAttribute(
        'data-dio',
        `${prefix}${button.dataset.policy}${suffix}`,
      )
      for (const b of example.querySelectorAll('[data-policy]'))
        b.setAttribute('aria-pressed', String(b === button))
    })
  }

  const setting = app.stage.reducedMotion as unknown as {
    value: boolean
  }
  const system = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches
  const reduce = example.querySelector<HTMLInputElement>('.reduce')
  on(reduce, 'change', () => {
    setting.value = reduce?.checked ?? false
  })
  off.push(() => {
    setting.value = system
  })

  // A hidden tab pauses the loop through app.pause('hidden'); the checkbox does the same.
  let resume: (() => void) | undefined
  const hidden = example.querySelector<HTMLInputElement>('.hidden')
  on(hidden, 'change', () => {
    if (hidden?.checked) resume ??= app.pause('hidden')
    else {
      resume?.()
      resume = undefined
    }
  })
  off.push(() => resume?.())

  // One cell per display refresh: did Diorama run a frame since the last one, and why.
  const cells = Array.from({ length: CELLS }, () => {
    const cell = document.createElement('span')
    cell.dataset.reason = 'none'
    return cell
  })
  tape?.replaceChildren(...cells)
  const reasons: string[] = Array(CELLS).fill('none')
  let last = app.loop.stats.frames
  let raf = 0
  const tick = () => {
    const { frames, reason } = app.loop.stats
    reasons.push(frames > last ? reason : 'none')
    reasons.shift()
    last = frames
    reasons.forEach((r, i) => {
      const cell = cells[i]
      if (cell && cell.dataset.reason !== r) cell.dataset.reason = r
    })
    if (meter) meter.textContent = String(frames)
    raf = requestAnimationFrame(tick)
  }
  // The tape runs only while the example is on screen.
  const seen = new IntersectionObserver(([entry]) => {
    cancelAnimationFrame(raf)
    if (entry?.isIntersecting) {
      last = app.loop.stats.frames
      raf = requestAnimationFrame(tick)
    }
  })
  seen.observe(example)
  off.push(() => {
    seen.disconnect()
    cancelAnimationFrame(raf)
  })
  return () => {
    for (const f of off) f()
  }
}
