// The search dialog and the 404 results. Rendering reads a View from the
// session, so the engine behind it can change.
import type { Framework } from '../lib/commands.ts'
import { FRAMEWORKS } from '../lib/commands.ts'
import { pagefindEngine } from '../search/engine.ts'
import { type PageLink, SearchSession, type View } from '../search/session.ts'
import type { PinnedHit, SearchData, SearchHit, SearchKind } from '../search/types.ts'

let session: SearchSession | undefined
let data: Promise<SearchData> | undefined

export function getSession(): SearchSession {
  const load = (): Promise<SearchData> => {
    data ??= fetch('/docs/search-data.json').then((r) => {
      if (!r.ok) throw new Error(`search data: ${r.status}`)
      return r.json() as Promise<SearchData>
    })
    data.catch(() => {
      data = undefined
    })
    return data
  }
  session ??= new SearchSession(pagefindEngine(), load, localStorage)
  return session
}

const escapeHtml = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

/** Pagefind excerpts are HTML with <mark>; anything else is dropped. */
const safeExcerpt = (html: string): string =>
  escapeHtml(html).replaceAll('&lt;mark&gt;', '<mark>').replaceAll('&lt;/mark&gt;', '</mark>')

const KIND_LABEL: Record<SearchKind, string> = {
  effect: 'Effect',
  guide: 'Guide',
  api: 'API',
  error: 'Error',
}

interface Item {
  readonly url: string
  readonly html: string
  readonly recent?: string
  readonly sub?: boolean
}

function hitBody(hit: Pick<SearchHit, 'title' | 'kind' | 'excerpt' | 'meta'>): string {
  const meta = hit.meta
  const media =
    hit.kind === 'effect' && meta.poster
      ? `<span class="sr-media"><img src="${escapeHtml(meta.poster)}" alt="" width="64" height="40" loading="lazy">${meta.clip ? `<video data-clip="${escapeHtml(meta.clip)}" muted loop playsinline aria-hidden="true"></video>` : ''}</span>`
      : ''
  const detail =
    hit.kind === 'api' && meta.signature
      ? `<code class="sr-sig">${escapeHtml(meta.signature)}</code>`
      : hit.kind === 'error' && meta.level
        ? `<span class="sr-level">${escapeHtml(meta.level)}</span>`
        : ''
  const excerpt = hit.excerpt ? `<span class="sr-excerpt">${safeExcerpt(hit.excerpt)}</span>` : ''
  return `${media}<span class="sr-text"><span class="sr-title">${escapeHtml(hit.title)}</span>${detail}${excerpt}</span>`
}

/** HTML of a view plus the flat list of choosable items, in keyboard order. */
export function renderView(
  view: View,
  opts: { listbox: boolean; idPrefix: string },
): { html: string; items: Item[] } {
  const items: Item[] = []
  const role = opts.listbox
  const option = (item: Item, cls = ''): string => {
    const id = `${opts.idPrefix}-${items.length}`
    items.push(item)
    const attrs = role ? ` id="${id}" role="option" aria-selected="false"` : ''
    const del =
      item.recent !== undefined
        ? `<button type="button" class="sr-del" tabindex="-1" data-forget="${escapeHtml(item.recent)}" aria-label="Remove ${escapeHtml(item.recent)} from recent searches">×</button>`
        : ''
    return `<div class="sr-item ${cls}"${attrs} data-index="${items.length - 1}"><a href="${escapeHtml(item.url)}" tabindex="-1">${item.html}</a>${del}</div>`
  }
  const group = (label: string, body: string, extra = ''): string => {
    const id = `${opts.idPrefix}-g${label.replace(/\W/g, '')}`
    return role
      ? `<div role="group" aria-labelledby="${id}" class="sr-group"><div class="sr-head" id="${id}" role="presentation">${escapeHtml(label)}${extra}</div>${body}</div>`
      : `<section class="sr-group"><h2 class="sr-head">${escapeHtml(label)}${extra}</h2>${body}</section>`
  }
  const popular = (list: readonly PageLink[]): string =>
    list.length
      ? group(
          'Popular',
          list
            .map((p) =>
              option({
                url: p.url,
                html: `<span class="sr-text"><span class="sr-title">${escapeHtml(p.title)}</span><span class="sr-excerpt">${KIND_LABEL[p.kind]}</span></span>`,
              }),
            )
            .join(''),
        )
      : ''

  let html = ''
  if (view.status === 'empty') {
    if (view.recent.length) {
      const clear = role
        ? ' <button type="button" class="sr-clear" tabindex="-1" data-clear>Clear</button>'
        : ''
      html += group(
        'Recent',
        view.recent
          .map((q) =>
            option({
              url: `?q=${encodeURIComponent(q)}`,
              recent: q,
              html: `<span class="sr-text"><span class="sr-title">${escapeHtml(q)}</span></span>`,
            }),
          )
          .join(''),
        clear,
      )
    }
    html += popular(view.popular)
    return { html, items }
  }
  if (view.typo) {
    html += `<p class="sr-typo">Did you mean <button type="button" class="sr-fix" data-query="${escapeHtml(view.typo)}">${escapeHtml(view.typo)}</button>?</p>`
  }
  if (view.status === 'none') {
    html += `<p class="sr-empty">No results for "${escapeHtml(view.query)}"</p>${popular(view.popular)}`
    return { html, items }
  }
  if (view.pinned.length) {
    html += `<div class="sr-pinned"${role ? ' role="group" aria-label="Best match"' : ''}>${view.pinned
      .map((p: PinnedHit) => option({ url: p.url, html: hitBody(p) }, 'pinned'))
      .join('')}</div>`
  }
  for (const g of view.groups) {
    const more =
      g.total > g.hits.length
        ? `<button type="button" class="sr-more" tabindex="-1" data-expand="${g.kind}">Show all ${g.total}</button>`
        : ''
    const body = g.hits
      .map(
        (hit) =>
          option({ url: hit.url, html: hitBody(hit) }) +
          hit.sub
            .map((s) =>
              option(
                {
                  url: s.url,
                  sub: true,
                  html: `<span class="sr-text"><span class="sr-title">${escapeHtml(s.title)}</span><span class="sr-excerpt">${safeExcerpt(s.excerpt)}</span></span>`,
                },
                'sub',
              ),
            )
            .join(''),
      )
      .join('')
    html += group(g.label, body + more)
  }
  return { html, items }
}

const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.closest('[data-editor]') !== null
  )
}

const storedFramework = (): Framework | undefined => {
  try {
    const v = localStorage.getItem('dio.framework')
    return FRAMEWORKS.some((f) => f.value === v) ? (v as Framework) : undefined
  } catch {
    return undefined
  }
}

export class DocSearch extends HTMLElement {
  #dialog!: HTMLDialogElement
  #input!: HTMLInputElement
  #list!: HTMLElement
  #status!: HTMLElement
  #filter!: HTMLButtonElement
  #items: Item[] = []
  #active = -1
  #returnFocus: HTMLElement | null = null
  #timer = 0
  #expanded: SearchKind | undefined
  #framework: Framework | undefined
  #bound = false

  connectedCallback(): void {
    if (this.#bound) return
    this.#bound = true
    this.#dialog = this.querySelector('dialog') as HTMLDialogElement
    this.#input = this.querySelector('input') as HTMLInputElement
    this.#list = this.querySelector('[role=listbox]') as HTMLElement
    this.#status = this.querySelector('[data-status]') as HTMLElement
    this.#filter = this.querySelector('[data-filter]') as HTMLButtonElement

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        this.#dialog.open ? this.close() : this.open()
      } else if (
        e.key === '/' &&
        !this.#dialog.open &&
        !isTyping(e.target) &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault()
        this.open()
      }
    })
    const wire = () => {
      for (const b of document.querySelectorAll<HTMLElement>('[data-search-open]')) {
        if (b.dataset.wired) continue
        b.dataset.wired = '1'
        b.addEventListener('click', () => this.open())
        const intent = () =>
          void getSession()
            .init()
            .catch(() => undefined)
        b.addEventListener('pointerenter', intent, { once: true })
        b.addEventListener('focus', intent, { once: true })
      }
      const q = new URLSearchParams(location.search).get('q')
      if (q !== null && !this.#dialog.open) this.open(q)
    }
    wire()
    document.addEventListener('astro:page-load', wire)
    document.addEventListener('astro:before-swap', () => {
      if (this.#dialog.open) this.close(false)
    })

    this.#input.addEventListener('input', () => {
      this.#expanded = undefined
      const url = new URL(location.href)
      url.searchParams.set('q', this.#input.value)
      history.replaceState(history.state, '', url)
      clearTimeout(this.#timer)
      this.#timer = window.setTimeout(() => void this.#run(), 120)
    })
    this.#input.addEventListener('keydown', (e) => this.#key(e))
    this.#list.addEventListener('keydown', (e) => this.#key(e))
    this.#list.addEventListener('click', (e) => this.#click(e))
    // pointermove, not pointerover: results drawn under a resting pointer get pointerover too, and
    // would take the selection from the first result while the reader types.
    this.#list.addEventListener('pointermove', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-index]')
      const index = Number(el?.dataset.index ?? this.#active)
      if (index !== this.#active) this.#select(index, false)
    })
    this.#dialog.addEventListener('cancel', (e) => {
      // Esc clears the query first; on an empty field it closes.
      e.preventDefault()
      if (this.#input.value) {
        this.#input.value = ''
        this.#input.dispatchEvent(new Event('input'))
      } else this.close()
    })
    this.#dialog.addEventListener('click', (e) => {
      if (e.target === this.#dialog) this.close()
    })
    this.#filter.addEventListener('click', () => {
      this.#framework = undefined
      this.#filter.hidden = true
      void this.#run()
    })
    this.querySelector('[data-close]')?.addEventListener('click', () => this.close())
  }

  open(query?: string): void {
    if (!this.#dialog.open) {
      this.#returnFocus = document.activeElement as HTMLElement | null
      this.#dialog.showModal()
    }
    this.#framework = storedFramework()
    const label = FRAMEWORKS.find((f) => f.value === this.#framework)?.label
    this.#filter.hidden = !label
    if (label) this.#filter.textContent = `${label} only ×`
    if (query !== undefined) this.#input.value = query
    this.#input.focus()
    this.#input.select()
    void this.#run()
  }

  close(restore = true): void {
    if (!this.#dialog.open) return
    this.#dialog.close()
    const url = new URL(location.href)
    if (url.searchParams.has('q')) {
      url.searchParams.delete('q')
      history.replaceState(history.state, '', url)
    }
    if (restore) this.#returnFocus?.focus()
  }

  async #run(): Promise<void> {
    const s = getSession()
    const query = this.#input.value
    const slow = window.setTimeout(() => {
      this.#status.textContent = 'Loading search'
    }, 300)
    try {
      const view = await s.run(query, { framework: this.#framework }, this.#expanded)
      clearTimeout(slow)
      if (!view) return
      const { html, items } = renderView(view, { listbox: true, idPrefix: 'sr' })
      this.#list.innerHTML = html
      this.#items = items
      this.#active = -1
      this.#input.removeAttribute('aria-activedescendant')
      this.#status.textContent =
        view.status === 'results'
          ? `${view.count} result${view.count === 1 ? '' : 's'}`
          : view.status === 'none'
            ? 'No results'
            : ''
      if (view.status === 'results') this.#select(0, false)
    } catch {
      clearTimeout(slow)
      this.#items = []
      this.#status.textContent = 'Search is unavailable offline'
      this.#list.innerHTML =
        '<p class="sr-empty">Search is unavailable offline. Browse <a href="/docs">the docs</a> or read <a href="/llms.txt">llms.txt</a>.</p>'
    }
  }

  #select(index: number, scroll = true): void {
    const els = this.#list.querySelectorAll<HTMLElement>('[data-index]')
    if (!els.length) return
    this.#active = Math.max(0, Math.min(index, els.length - 1))
    els.forEach((el, i) => {
      const on = i === this.#active
      el.setAttribute('aria-selected', String(on))
      const video = el.querySelector<HTMLVideoElement>('video[data-clip]')
      if (video) this.#clip(video, on)
    })
    const el = els[this.#active]
    if (!el) return
    this.#input.setAttribute('aria-activedescendant', el.id)
    if (scroll) el.scrollIntoView({ block: 'nearest' })
  }

  /** Recorded clips play on the selected effect only, never under reduced motion. */
  #clip(video: HTMLVideoElement, on: boolean): void {
    if (on && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (!video.src) video.src = video.dataset.clip ?? ''
      void video.play().catch(() => undefined)
    } else video.pause()
  }

  #go(index: number, newTab: boolean): void {
    const item = this.#items[index]
    if (!item) return
    if (item.recent !== undefined) {
      this.#input.value = item.recent
      this.#input.dispatchEvent(new Event('input'))
      return
    }
    getSession().remember(this.#input.value)
    if (newTab) {
      window.open(item.url, '_blank', 'noopener')
      return
    }
    this.close(false)
    const a = this.#list.querySelector<HTMLAnchorElement>(`[data-index="${index}"] a`)
    // A click on the link keeps ClientRouter navigation and its flights.
    a?.click()
  }

  #groupStarts(): number[] {
    const starts: number[] = []
    for (const group of this.#list.querySelectorAll('.sr-group, .sr-pinned')) {
      const first = group.querySelector<HTMLElement>('[data-index]')
      if (first) starts.push(Number(first.dataset.index))
    }
    return starts
  }

  #key(e: KeyboardEvent): void {
    const n = this.#items.length
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (n) this.#select(this.#active + 1 >= n ? 0 : this.#active + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        if (n) this.#select(this.#active <= 0 ? n - 1 : this.#active - 1)
        break
      case 'PageDown':
      case 'PageUp': {
        e.preventDefault()
        const starts = this.#groupStarts()
        const target =
          e.key === 'PageDown'
            ? starts.find((s) => s > this.#active)
            : [...starts].reverse().find((s) => s < this.#active)
        if (target !== undefined) this.#select(target)
        break
      }
      case 'Enter':
        e.preventDefault()
        this.#go(this.#active < 0 ? 0 : this.#active, e.metaKey || e.ctrlKey)
        break
      case 'Delete': {
        const item = this.#items[this.#active]
        if (item?.recent === undefined || (e.target === this.#input && this.#input.value)) break
        e.preventDefault()
        getSession().forget(item.recent)
        void this.#run()
        break
      }
    }
  }

  #click(e: MouseEvent): void {
    const target = e.target as HTMLElement
    const forget = target.closest<HTMLElement>('[data-forget]')
    if (forget) {
      e.preventDefault()
      getSession().forget(forget.dataset.forget ?? '')
      void this.#run()
      return
    }
    if (target.closest('[data-clear]')) {
      getSession().clear()
      void this.#run()
      return
    }
    const expand = target.closest<HTMLElement>('[data-expand]')
    if (expand) {
      this.#expanded = expand.dataset.expand as SearchKind
      void this.#run()
      return
    }
    const fix = target.closest<HTMLElement>('[data-query]')
    if (fix) {
      this.#input.value = fix.dataset.query ?? ''
      this.#input.dispatchEvent(new Event('input'))
      return
    }
    const item = target.closest<HTMLElement>('[data-index]')
    if (!item) return
    const index = Number(item.dataset.index)
    if (this.#items[index]?.recent !== undefined) {
      e.preventDefault()
      this.#go(index, false)
      return
    }
    getSession().remember(this.#input.value)
    if (!(e.metaKey || e.ctrlKey)) this.close(false)
  }
}

/** The 404 page searches for its own path and shows the results inline. */
export class DocSearchPage extends HTMLElement {
  connectedCallback(): void {
    const words = location.pathname
      .replace(/^\/docs/, '')
      .replace(/\.html$/, '')
      .replace(/[-/_]+/g, ' ')
      .trim()
    const out = this.querySelector('[data-results]') as HTMLElement
    const status = this.querySelector('[data-status]') as HTMLElement
    getSession()
      .run(words)
      .then((view) => {
        if (!view) return
        const { html } = renderView(view, { listbox: false, idPrefix: 'nf' })
        out.innerHTML = html
        status.textContent = words ? `Results for "${words}"` : ''
      })
      .catch(() => {
        status.textContent = 'Search is unavailable offline.'
      })
  }
}
