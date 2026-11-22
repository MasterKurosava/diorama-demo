// Drives the paper sheet of Cover.astro. A page change that is still loading after SHOW_AFTER gets
// the sheet, named after the page being opened; it lifts off once that page can be seen. Fast
// changes never see it. Between the landscape and its work pages pictures fly on their own sheet,
// so those changes are left alone.
const SHOW_AFTER = 180
// The sheet finishes coming up before it leaves.
const SHOWN_AT_LEAST = 700
// The longest a scene page may keep it up while its first screen draws.
const HOLD = 6000
const SETTLED = new Set(['drawn', 'live', 'failed', 'off'])
const SECTIONS: Record<string, string> = {
  start: 'Get started',
  learn: 'Learn',
  guides: 'Guides',
  effects: 'Effects',
  api: 'API',
  concepts: 'Concepts',
  errors: 'Errors',
  examples: 'Examples',
}

export type Tone = 'dusk' | 'paper' | 'night'

const root = document.documentElement
let timer = 0
let up = false
let since = 0
let turn = 0
let title = ''

export const clean = (path: string): string => path.replace(/\.html$/, '').replace(/\/$/, '') || '/'
/** The landscape and its work pages, which change with flights instead of the sheet. */
export const scene = (path: string): boolean => path === '/' || path.startsWith('/work/')

/** The name and the paper of the page at `path`. */
export function place(path: string, dark: boolean): { title: string; tone: Tone } {
  if (path === '/') return { title: 'Diorama', tone: 'dusk' }
  if (path.startsWith('/work/')) {
    const name = path.slice(6)
    return {
      title: name.charAt(0).toUpperCase() + name.slice(1),
      tone: name === 'lantern' ? 'night' : 'paper',
    }
  }
  const section = path.split('/')[2] ?? ''
  return { title: SECTIONS[section] ?? 'Docs', tone: dark ? 'night' : 'paper' }
}

function darkDocs(): boolean {
  let theme: string | null = null
  try {
    theme = localStorage.getItem('dio.theme')
  } catch {}
  return theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
}

const sheet = (): HTMLElement | null => document.getElementById('passage')
const pause = (ms: number) => new Promise((done) => setTimeout(done, Math.max(0, ms)))

function say(what: string): void {
  const line = sheet()?.querySelector('.passage-what')
  if (line) line.textContent = what && what !== title ? what : ''
}

function show(): void {
  const el = sheet()
  if (!el) return
  el.classList.remove('out', 'done')
  el.classList.add('on')
  up = true
  since = performance.now()
}

/** The first screen of a scene page is drawn, or has given up. */
function drawn(): boolean {
  return [...document.querySelectorAll('[data-dio]')].every((e) => {
    const box = e.getBoundingClientRect()
    const visible = box.bottom > 0 && box.top < innerHeight && box.width > 0
    return !visible || SETTLED.has(e.getAttribute('data-dio-state') ?? '')
  })
}

async function lift(): Promise<void> {
  const mine = turn
  const el = sheet()
  if (!el) return
  // A first visit to the landscape brings its own loader: the sheet hands over to it at once.
  if (scene(clean(location.pathname)) && !document.querySelector('.loader')) {
    const until = performance.now() + HOLD
    while (!drawn() && performance.now() < until) {
      await pause(100)
      if (mine !== turn) return
    }
  } else await document.fonts.ready
  await pause(SHOWN_AT_LEAST - (performance.now() - since))
  if (mine !== turn) return
  el.classList.add('done')
  await pause(180)
  if (mine !== turn) return
  el.classList.add('out')
  up = false
  delete root.dataset.covered
  await pause(650)
  if (mine === turn) el.classList.remove('on', 'out', 'done')
}

document.addEventListener('astro:before-preparation', (event) => {
  const from = clean(location.pathname)
  const to = clean(event.to.pathname)
  if (from === to || (scene(from) && scene(to))) return
  const el = sheet()
  if (!el) return
  turn++
  const next = place(to, darkDocs())
  title = next.title
  el.dataset.tone = next.tone
  const where = el.querySelector('.passage-where span')
  if (where) where.textContent = next.title
  const path = el.querySelector('.passage-path')
  if (path) path.textContent = location.host + (to === '/' ? '' : to)
  const link = event.sourceElement?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  say(link.length <= 48 ? link : '')
  clearTimeout(timer)
  // Already up for an earlier change: it stays and names the new page.
  if (up) el.classList.remove('done', 'out')
  else timer = window.setTimeout(show, SHOW_AFTER)
})

document.addEventListener('astro:before-swap', (event) => {
  clearTimeout(timer)
  if (!up) return
  say(event.newDocument.title.replace(/\s·\s.*$/, ''))
  // Both sides, since the swap takes the attributes of the new <html>.
  root.dataset.covered = ''
  event.newDocument.documentElement.dataset.covered = ''
})

document.addEventListener('astro:page-load', () => {
  if (up) void lift()
})
