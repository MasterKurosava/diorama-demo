// 07 Out of the box. A print plays while the pointer or the focus is on it. While nobody points,
// the prints in view come alive one at a time, each for about one loop, so the wall moves without
// every clip decoding at once. With reduced motion only what the visitor points at plays.
const TURN = 3400

export function mount(): () => void {
  const prints = [...document.querySelectorAll<HTMLElement>('.cat-print')]
  if (!prints.length) return () => {}
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const seen = new Set<HTMLElement>()
  let pointed: HTMLElement | undefined
  let turn = -1
  let timer = 0

  const play = (print: HTMLElement, on: boolean): void => {
    const video = print.querySelector('video')
    if (!video) return
    print.classList.toggle('live', on)
    if (on) void video.play().catch(() => {})
    else video.pause()
  }
  const next = (): void => {
    clearTimeout(timer)
    timer = 0
    if (reduced || pointed) return
    for (const print of prints) if (print.classList.contains('live')) play(print, false)
    const visible = prints.filter((p) => seen.has(p))
    if (!visible.length) return
    turn = (turn + 1) % visible.length
    const print = visible[turn]
    if (print) play(print, true)
    timer = window.setTimeout(next, TURN)
  }
  const watch = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const print = entry.target as HTMLElement
        if (entry.isIntersecting) seen.add(print)
        else {
          seen.delete(print)
          if (print !== pointed) play(print, false)
        }
      }
      if (!timer && !pointed) next()
    },
    { threshold: 0.6 },
  )

  const enter = (event: Event): void => {
    const print = (event.target as Element | null)?.closest<HTMLElement>('.cat-print')
    if (!print || print === pointed) return
    clearTimeout(timer)
    timer = 0
    for (const other of prints) if (other !== print) play(other, false)
    pointed = print
    play(print, true)
  }
  const leave = (event: Event): void => {
    const print = (event.target as Element | null)?.closest<HTMLElement>('.cat-print')
    if (!print || print !== pointed) return
    const to = (event as PointerEvent | FocusEvent).relatedTarget as Node | null
    if (to && print.contains(to)) return
    play(print, false)
    pointed = undefined
    timer = window.setTimeout(next, 900)
  }

  const wall = prints[0]?.parentElement
  for (const print of prints) watch.observe(print)
  wall?.addEventListener('pointerover', enter)
  wall?.addEventListener('pointerout', leave)
  wall?.addEventListener('focusin', enter)
  wall?.addEventListener('focusout', leave)
  return () => {
    clearTimeout(timer)
    watch.disconnect()
    wall?.removeEventListener('pointerover', enter)
    wall?.removeEventListener('pointerout', leave)
    wall?.removeEventListener('focusin', enter)
    wall?.removeEventListener('focusout', leave)
    for (const print of prints) play(print, false)
  }
}
