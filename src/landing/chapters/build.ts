// 08 For developers. The studio types each step's files in and switches the real effects on in the
// page beside them as the lines land: fire on the heading, ripple on the photo, a blue copy of
// fire, a typo caught and fixed, then the hover trigger that lets the frame count fall to 0. The
// steps go round while the studio is on screen; a chip jumps to its step and the button pauses.
// With reduced motion each step shows whole and nothing moves on by itself.
import type { App } from '@dioramajs/diorama'
import { play, pointer, quiet } from '../ghost'

/** Per typed character, ms. */
const CHAR = 34
/** Before a line or a block appears, ms. */
const LINE = 160
/** A finished step stays this long, ms. */
const HOLD = 4200
/** What the hand takes over the photo or the heading, ms. */
const FEEL = 2600
/** The longest wait for the page to come to rest, ms. */
const CALM = 9000
const BLUE = '#5ab8ff'

export function mount(app: App): () => void {
  const studio = document.querySelector<HTMLElement>('.studio')
  const title = studio?.querySelector<HTMLElement>('.sp-title')
  const photo = studio?.querySelector<HTMLElement>('.sp-photo')
  if (!studio || !title || !photo) return () => {}
  const chips = [...studio.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const panels = chips.map((chip) =>
    document.getElementById(chip.getAttribute('aria-controls') ?? ''),
  )
  const pause = studio.querySelector<HTMLButtonElement>('.studio-pause')
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const off = new AbortController()
  const caret = document.createElement('i')
  caret.className = 'caret'
  caret.setAttribute('aria-hidden', 'true')

  let current = 0
  let seen = false
  let paused = reduced
  let held = false
  let started = false
  let run: AbortController | undefined
  let began = false

  // The text of every typed or erased piece, kept before anything empties it.
  const texts = new Map<Element, { node: Text; full: string }[]>()
  for (const el of studio.querySelectorAll('.ty, .er, .sq')) {
    const nodes: { node: Text; full: string }[] = []
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode())
      nodes.push({ node: n as Text, full: (n as Text).data })
    texts.set(el, nodes)
  }
  const fill = (el: Element, on: boolean): void => {
    for (const { node, full } of texts.get(el) ?? []) node.data = on ? full : ''
  }

  /** The panel as it starts: nothing typed, late lines held back. */
  const reset = (panel: HTMLElement): void => {
    for (const el of panel.querySelectorAll('.ty')) fill(el, false)
    for (const el of panel.querySelectorAll('.er, .sq')) fill(el, true)
    for (const el of panel.querySelectorAll('[data-seq="show"]')) el.setAttribute('data-hold', '')
    panel.classList.remove('flagged')
    caret.remove()
  }
  /** The panel as it ends. */
  const finish = (panel: HTMLElement): void => {
    for (const el of panel.querySelectorAll('.ty')) fill(el, true)
    for (const el of panel.querySelectorAll('.er')) fill(el, false)
    for (const el of panel.querySelectorAll('[data-hold]')) el.removeAttribute('data-hold')
    for (const sq of panel.querySelectorAll('.sq')) sq.textContent = 'strength'
    panel.classList.remove('flagged')
    caret.remove()
  }

  const set = (el: Element, name: string, value: string | null): void => {
    if (el.getAttribute(name) === value) return
    if (value === null) el.removeAttribute(name)
    else el.setAttribute(name, value)
  }
  /** The page with the steps before `n` done. */
  const level = (n: number): void => {
    started = n > 0
    set(title, 'data-dio', n > 1 ? 'fire' : null)
    set(photo, 'data-dio', n > 2 ? 'ripple' : null)
    set(title, 'data-dio-color', n > 3 ? BLUE : null)
    set(title, 'data-dio-strength', n > 4 ? '1.6' : null)
    set(title, 'data-dio-trigger', n > 5 ? 'hover' : null)
  }

  const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason)
      const timer = setTimeout(resolve, ms)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(signal.reason)
        },
        { once: true },
      )
    })

  /** The visitor's hand is elsewhere and resting, so the ghost may show what the visitor could do. */
  const feel = async (el: HTMLElement, points: [number, number][]): Promise<void> => {
    if (reduced || quiet() < 1500) return
    const at = pointer()
    const box = studio.getBoundingClientRect()
    if (at && at.x > box.left && at.x < box.right && at.y > box.top && at.y < box.bottom) return
    const r = el.getBoundingClientRect()
    await play(
      async (hand) => {
        await hand.stroke(() => el.getBoundingClientRect(), points, FEEL - 600)
        await hand.wait(600)
      },
      { x: r.right + 40, y: r.bottom + 60 },
    )
  }

  const act = async (name: string | undefined, signal: AbortSignal): Promise<void> => {
    switch (name) {
      case 'start':
        started = true
        break
      case 'fire':
        set(title, 'data-dio', 'fire')
        break
      case 'ripple':
        set(photo, 'data-dio', 'ripple')
        break
      case 'feel-photo':
        await sleep(500, signal)
        await feel(photo, [
          [0.15, 0.35],
          [0.45, 0.62],
          [0.7, 0.4],
          [0.88, 0.58],
        ])
        break
      case 'blue':
        set(title, 'data-dio-color', BLUE)
        break
      case 'fix':
        for (const sq of studio.querySelectorAll('.sq')) sq.textContent = 'strength'
        set(title, 'data-dio-strength', '1.6')
        break
      case 'rest':
        set(title, 'data-dio-trigger', 'hover')
        break
      case 'calm': {
        // Until the page draws nothing, then a moment for the 0 to be read.
        const until = performance.now() + CALM
        let last = app.loop.time.frame
        while (performance.now() < until) {
          await sleep(600, signal)
          const now = app.loop.time.frame
          if (now === last) break
          last = now
        }
        await sleep(1400, signal)
        break
      }
      case 'feel-title':
        await feel(title, [
          [0.05, 0.6],
          [0.5, 0.45],
          [0.95, 0.6],
        ])
        break
    }
  }

  const type = async (el: Element, signal: AbortSignal): Promise<void> => {
    for (const { node, full } of texts.get(el) ?? []) {
      for (let k = 1; k <= full.length; k++) {
        node.data = full.slice(0, k)
        node.after(caret)
        await sleep(CHAR * (0.6 + Math.random() * 0.8), signal)
      }
    }
  }
  const erase = async (el: Element, signal: AbortSignal): Promise<void> => {
    for (const { node } of [...(texts.get(el) ?? [])].reverse()) {
      while (node.data.length) {
        node.data = node.data.slice(0, -1)
        node.after(caret)
        await sleep(CHAR * 1.4, signal)
      }
    }
  }

  /** Plays a step: its lines in order, the page answering each act. */
  const perform = async (panel: HTMLElement, signal: AbortSignal): Promise<void> => {
    for (const item of panel.querySelectorAll<HTMLElement>('[data-seq]')) {
      const seq = item.dataset.seq
      if (seq === 'show') {
        await sleep(LINE, signal)
        item.removeAttribute('data-hold')
      } else if (seq === 'type') await type(item, signal)
      else if (seq === 'erase') await erase(item, signal)
      else if (seq === 'act') await act(item.dataset.act, signal)
      else if (seq === 'wait') await sleep(Number(item.dataset.ms) || 0, signal)
      else if (seq === 'flag') panel.classList.toggle('flagged', item.dataset.on === 'true')
    }
  }

  /** How long a step takes, for the bar under its chip. */
  const length = (panel: HTMLElement | null): number => {
    if (!panel) return HOLD
    let ms = HOLD
    for (const item of panel.querySelectorAll<HTMLElement>('[data-seq]')) {
      const seq = item.dataset.seq
      if (seq === 'show') ms += LINE
      else if (seq === 'type') ms += (item.textContent?.length ?? 0) * CHAR
      else if (seq === 'erase') ms += (item.textContent?.length ?? 0) * CHAR * 1.4
      else if (seq === 'wait') ms += Number(item.dataset.ms) || 0
      else if (item.dataset.act?.startsWith('feel')) ms += FEEL + 500
      else if (item.dataset.act === 'calm') ms += 4000
    }
    return ms
  }
  const lengths = panels.map(length)

  const select = (index: number, focus = false): void => {
    current = (index + chips.length) % chips.length
    chips.forEach((chip, i) => {
      const on = i === current
      chip.setAttribute('aria-selected', String(on))
      chip.tabIndex = on ? 0 : -1
      chip.classList.remove('timed')
      const panel = panels[i]
      if (panel) panel.hidden = !on
    })
    const chip = chips[current]
    if (focus) chip?.focus()
    const row = chip?.parentElement
    if (chip && row && row.scrollWidth > row.clientWidth)
      row.scrollTo({ left: chip.offsetLeft - 24, behavior: reduced ? 'auto' : 'smooth' })
  }

  /** Shows a step: typed in when motion is fine, whole otherwise, then on to the next. */
  const go = (index: number, focus = false): void => {
    run?.abort()
    const own = new AbortController()
    run = own
    select(index, focus)
    const panel = panels[current]
    if (!panel) return
    level(current)
    if (reduced) {
      finish(panel)
      level(current + 1)
      return
    }
    reset(panel)
    const chip = chips[current]
    chip?.style.setProperty('--step', `${lengths[current]}ms`)
    void chip?.offsetWidth
    chip?.classList.add('timed')
    const { signal } = own
    void (async () => {
      try {
        await perform(panel, signal)
        await sleep(HOLD, signal)
        // Moves on only while the studio is on screen and nobody holds or reads it.
        while (paused || held || !seen) await sleep(300, signal)
        go(current + 1)
      } catch {
        // Another step took over.
      }
    })()
  }

  const onChip = (e: MouseEvent): void => {
    const chip = (e.target as Element | null)?.closest<HTMLButtonElement>('[role="tab"]')
    if (chip) go(chips.indexOf(chip))
  }
  const onKey = (e: KeyboardEvent): void => {
    const keys: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowDown: current + 1,
      ArrowLeft: current - 1,
      ArrowUp: current - 1,
      Home: 0,
      End: chips.length - 1,
    }
    const to = keys[e.key]
    if (to === undefined) return
    e.preventDefault()
    go(to, true)
  }
  const onPause = (): void => {
    paused = !paused
    pause?.setAttribute('aria-pressed', String(paused))
    pause?.setAttribute('aria-label', paused ? 'Play the steps' : 'Pause the steps')
    studio.classList.toggle('paused', paused)
  }

  // Frames the page drew in the last second, the renderer and the effects at work in the page.
  const gpu = studio.querySelector<HTMLElement>('.st-gpu')
  const gpuName = studio.querySelector<HTMLElement>('.st-gpu-name')
  const fx = studio.querySelector<HTMLElement>('.st-fx')
  const fps = studio.querySelector<HTMLElement>('.st-fps b')
  const quarter: number[] = [0, 0, 0, 0]
  let before = -1
  const renderer = (): string => {
    const render = app.state.value === 'running' ? app.effects.render : undefined
    const backend = (render?.renderer as { backend?: { isWebGPUBackend?: boolean } } | undefined)
      ?.backend
    if (!backend) return 'plain HTML'
    return backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2'
  }
  const sample = setInterval(() => {
    if (!seen) return
    const frame = app.loop.time.frame
    quarter.push(before < 0 ? 0 : frame - before)
    quarter.shift()
    before = frame
    const second = quarter.reduce((sum, n) => sum + n, 0)
    if (fps) fps.textContent = String(second)
    const name = started ? renderer() : 'plain HTML'
    if (gpuName && gpuName.textContent !== name) gpuName.textContent = name
    gpu?.classList.toggle('on', started && name !== 'plain HTML')
    const live = [title, photo]
      .filter((el) => /^(live|drawn)$/.test(el.getAttribute('data-dio-state') ?? ''))
      .map((el) => el.getAttribute('data-dio') ?? '')
      .filter(Boolean)
      .join(' · ')
    if (fx && fx.textContent !== live) fx.textContent = live
  }, 250)

  const watch = new IntersectionObserver(
    ([entry]) => {
      seen = Boolean(entry?.isIntersecting)
      studio.classList.toggle('seen', seen)
      if (seen && !began) {
        began = true
        go(0)
      }
    },
    { threshold: 0.4 },
  )

  // Before it is first seen the studio waits at the start of step one.
  for (const panel of panels) if (panel) (reduced ? finish : reset)(panel)
  level(0)
  const { signal } = off
  const list = chips[0]?.parentElement
  list?.addEventListener('click', onChip, { signal })
  list?.addEventListener('keydown', onKey, { signal })
  pause?.addEventListener('click', onPause, { signal })
  if (reduced) pause?.setAttribute('hidden', '')
  // The ghost's own moves cross the studio too; only the visitor's hand holds it.
  const hold =
    (on: boolean) =>
    (e: Event): void => {
      if (e.isTrusted) held = on
    }
  studio.addEventListener('pointerenter', hold(true), { signal })
  studio.addEventListener('pointerleave', hold(false), { signal })
  studio.addEventListener('focusin', hold(true), { signal })
  studio.addEventListener('focusout', hold(false), { signal })
  watch.observe(studio)
  return () => {
    run?.abort()
    off.abort()
    clearInterval(sample)
    watch.disconnect()
    level(0)
  }
}
