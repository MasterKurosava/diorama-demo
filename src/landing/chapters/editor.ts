// 06 Editor. The ink effect's own source, rebuilt on the page as you type. In dev the new version
// goes through redefine (what the Vite plugin's HMR calls), in a build through effects.register,
// which rebuilds the instances the same way. The meter counts frames actually drawn.

import type { Effect } from 'dioramajs'
import { type App, color, effect, oneOf, ready, redefine } from 'dioramajs'
import source from '../../effects/ink.ts?raw'

export function mount(app: App): () => void {
  const room = document.querySelector<HTMLElement>('.ed')
  if (!room?.querySelector('img[data-dio="ink"]')) return () => {}
  const off = new AbortController()
  const swap = (next: Effect): void => {
    if (import.meta.env.DEV) redefine('ink', next)
    else app.effects.register({ ink: next })
  }

  const file = source.replace(/\n$/, '')

  const picture = room.querySelector<HTMLImageElement>('img[data-dio="ink"]')
  const area = room.querySelector<HTMLTextAreaElement>('.field textarea')
  const paint = room.querySelector<HTMLElement>('.paint code')
  const gutter = room.querySelector<HTMLElement>('.gutter')
  const field = room.querySelector<HTMLElement>('.field')
  const state = room.querySelector<HTMLElement>('.ed-state')
  const problem = room.querySelector<HTMLElement>('.problem')
  const resetButton = room.querySelector<HTMLButtonElement>('.reset')
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches

  // Highlighting

  const TOKENS =
    /(\/\/[^\n]*)|('(?:[^'\\\n]|\\.)*'?|"(?:[^"\\\n]|\\.)*"?|`(?:[^`\\]|\\.)*`?)|((?<![\w$.])(?:\d+(?:\.\d+)?|\.\d+)(?![\w$]))|\b(import|from|export|default|const|let|var|return|new|if|else|true|false|null|undefined|function|of|in|for|while|as|typeof)\b|([A-Za-z_$][\w$]*)(?=\s*\()|((?<=\.)[A-Za-z_$][\w$]*)|([{}()[\],;:.=<>+\-*/!?&|%]+)/g
  const KINDS = ['c', 's', 'n', 'k', 'f', 'p', 'o'] as const
  const COLOUR = /^['"](#[0-9a-f]{3}(?:[0-9a-f]{3})?)['"]$/i
  const NUMBER = /(?<![\w$.)\]])-?(?:\d+(?:\.\d+)?|\.\d+)(?![\w$])/g

  const escapeHtml = (text: string): string =>
    text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))

  function highlight(code: string): string {
    let html = ''
    let last = 0
    for (const match of code.matchAll(TOKENS)) {
      const index = match.index ?? 0
      html += escapeHtml(code.slice(last, index))
      const kind = KINDS[match.slice(1).findIndex((group) => group !== undefined)]
      html += kind ? `<span class="t-${kind}">${escapeHtml(match[0])}</span>` : escapeHtml(match[0])
      last = index + match[0].length
    }
    // Trailing newline so an empty last line keeps its height.
    return `${html}${escapeHtml(code.slice(last))}\n`
  }

  let problemLine: number | undefined

  /** Repaints the code and the gutter (line numbers, error marker, colour swatches). */
  function render(): void {
    if (!area || !paint || !gutter || !field) return
    const code = area.value
    paint.innerHTML = highlight(code)
    // Reuse rows so an open colour picker survives edits.
    const lines = code.split('\n')
    while (gutter.children.length > lines.length) gutter.lastElementChild?.remove()
    for (const [i, line] of lines.entries()) {
      const row =
        (gutter.children[i] as HTMLElement | undefined) ??
        gutter.appendChild(document.createElement('div'))
      if (!row.lastChild) row.append(String(i + 1))
      row.classList.toggle('bad', problemLine === i + 1)
      const hex = colourOn(line)?.hex
      const label = row.querySelector<HTMLLabelElement>('.ed-swatch')
      if (!hex) label?.remove()
      else if (label) {
        label.style.background = hex
        const input = label.querySelector('input')
        if (input && document.activeElement !== input) input.value = hex
      } else row.prepend(swatch(i, hex))
    }
    field.querySelector('.problem-line')?.remove()
    if (problemLine !== undefined) {
      const bar = document.createElement('div')
      bar.className = 'problem-line'
      bar.style.top = `${14 + (problemLine - 1) * metrics().line}px`
      field.prepend(bar)
    }
    // The textarea is sized to the code and the panel does the scrolling.
    area.scrollTop = area.scrollLeft = 0
    if (resetButton) resetButton.hidden = code === file
  }

  /** First colour literal on a line, with its offset, length and six-digit hex. */
  function colourOn(line: string): { at: number; length: number; hex: string } | undefined {
    for (const m of line.matchAll(/(['"])#[0-9a-f]{3,6}\1/gi)) {
      const hex = COLOUR.exec(m[0])?.[1]
      if (!hex) continue
      const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex
      return { at: (m.index ?? 0) + 1, length: hex.length, hex: full.toLowerCase() }
    }
    return undefined
  }

  function swatch(line: number, hex: string): HTMLElement {
    const label = document.createElement('label')
    label.className = 'ed-swatch'
    label.style.background = hex
    label.title = 'Pick another colour'
    const input = document.createElement('input')
    input.type = 'color'
    input.value = hex
    input.setAttribute('aria-label', `Colour on line ${line + 1}`)
    input.addEventListener('input', () => {
      const found = colourOn(area?.value.split('\n')[line] ?? '')
      if (!found) return
      const start = offsetOf(line) + found.at
      replace(start, start + found.length, input.value, false)
      soon(140)
    })
    label.append(input)
    return label
  }

  function offsetOf(line: number): number {
    return (area?.value.split('\n').slice(0, line).join('\n').length ?? 0) + (line > 0 ? 1 : 0)
  }

  /** Edits through execCommand when possible so undo keeps working. */
  function replace(start: number, end: number, text: string, focus = true): void {
    if (!area) return
    // execCommand needs focus, but the colour picker must keep focus to stay open, so its writes
    // skip the undo history.
    if (focus) {
      area.focus({ preventScroll: true })
      area.setSelectionRange(start, end)
    }
    if (!focus || !document.execCommand('insertText', false, text)) {
      area.setRangeText(text, start, end, 'preserve')
    }
    render()
  }

  let measured: { char: number; line: number } | undefined
  function metrics(): { char: number; line: number } {
    if (measured || !area) return measured ?? { char: 7.8, line: 21 }
    const style = getComputedStyle(area)
    const probe = document.createElement('canvas').getContext('2d')
    if (!probe) return { char: 7.8, line: 21 }
    probe.font = `${style.fontSize} ${style.fontFamily}`
    measured = {
      char: probe.measureText('0'.repeat(100)).width / 100,
      line: parseFloat(style.lineHeight),
    }
    return measured
  }
  const remeasure = (): void => {
    measured = undefined
    render()
  }
  void document.fonts.ready.then(remeasure)
  addEventListener('resize', remeasure, { signal: off.signal })

  // Scrubbing numbers

  /** Number literal under the pointer, as offsets into the code. */
  function numberAt(e: PointerEvent): { start: number; end: number; text: string } | undefined {
    if (!area) return
    const r = area.getBoundingClientRect()
    const style = getComputedStyle(area)
    const { char, line } = metrics()
    const row = Math.floor((e.clientY - r.top - parseFloat(style.paddingTop)) / line)
    const col = Math.floor((e.clientX - r.left - parseFloat(style.paddingLeft)) / char)
    const text = area.value.split('\n')[row]
    if (text === undefined || col < 0) return
    for (const m of text.matchAll(NUMBER)) {
      const from = m.index ?? 0
      if (col >= from && col < from + m[0].length) {
        const start = offsetOf(row) + from
        return { start, end: start + m[0].length, text: m[0] }
      }
    }
    return undefined
  }

  let scrub:
    | {
        id: number
        x: number
        start: number
        end: number
        value: number
        step: number
        places: number
        moved: boolean
      }
    | undefined

  if (area && fine) {
    area.addEventListener('pointermove', (e) => {
      if (scrub) {
        const dx = e.clientX - scrub.x
        if (!scrub.moved && Math.abs(dx) < 3) return
        scrub.moved = true
        const steps = Math.round(dx / (e.shiftKey ? 1 : 4)) * (e.altKey ? 0.1 : 1)
        const value = scrub.value + steps * scrub.step
        const text = value.toFixed(scrub.places + (e.altKey ? 1 : 0)).replace(/^-0(\.0+)?$/, '0$1')
        if (text === area.value.slice(scrub.start, scrub.end)) return
        replace(scrub.start, scrub.end, text)
        scrub.end = scrub.start + text.length
        soon(120)
        return
      }
      area.classList.toggle('scrub', !!numberAt(e))
    })
    area.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      const hit = numberAt(e)
      if (!hit) return
      e.preventDefault()
      const places = hit.text.split('.')[1]?.length ?? 0
      const value = Number(hit.text)
      scrub = {
        id: e.pointerId,
        x: e.clientX,
        start: hit.start,
        end: hit.end,
        value,
        step: places ? 10 ** -places : Math.abs(value) >= 10 ? 1 : 0.1,
        places: places || (Math.abs(value) >= 10 ? 0 : 1),
        moved: false,
      }
      area.setPointerCapture(e.pointerId)
    })
    const end = (): void => {
      if (!scrub) return
      const { moved, start } = scrub
      scrub = undefined
      if (!moved) {
        // Click without a drag, so just place the caret.
        area.focus({ preventScroll: true })
        area.setSelectionRange(start, start)
      } else soon(0)
    }
    area.addEventListener('pointerup', end)
    area.addEventListener('pointercancel', end)
    area.addEventListener('lostpointercapture', end)
  }

  // Rebuilding

  type Namespace = Record<string, unknown>
  type Modules = Record<string, Namespace>

  class CodeError extends Error {
    constructor(
      message: string,
      readonly line?: number,
    ) {
      super(message)
    }
  }

  /** Modules the edited code may import (the same as the effect file), plus three. */
  const load = once(() =>
    Promise.all([
      import('three/tsl'),
      import('three/webgpu'),
      import('../../effects/_ink'),
      import('../../effects/_look'),
      import('../../effects/ink'),
    ]).then(([tsl, three, ink, look, saved]) => ({
      tsl,
      three,
      shared: { 'three/tsl': tsl, './_ink': ink, './_look': look } as Modules,
      saved: saved.default as unknown as Effect,
    })),
  )
  function once<T>(make: () => T): () => T {
    let value: { v: T } | undefined
    return () => {
      value ??= { v: make() }
      return value.v
    }
  }

  const IMPORT =
    /^[ \t]*import\s+(?:\{([^}]*)\}|\*\s+as\s+([\w$]+))\s+from\s+(['"])([^'"\n]+)\3;?/gm
  const lineAt = (code: string, index: number): number => code.slice(0, index).split('\n').length

  /**
   * Turns the file into a function body. Imports become reads from the namespaces passed in, kept on
   * the same line so error line numbers still match, and `export default` becomes a return.
   */
  function translate(code: string, modules: Modules): string {
    let body = code.replace(
      IMPORT,
      (match, named?: string, star?: string, _q?: string, from = '', index = 0) => {
        const line = lineAt(code, index)
        const module = modules[from]
        if (!module)
          throw new CodeError(
            `"${from}" is not available here: import from ${Object.keys(modules).join(', ')}`,
            line,
          )
        const keep = '\n'.repeat(match.split('\n').length - 1)
        const source = `__modules[${JSON.stringify(from)}]`
        if (star) return `const ${star} = ${source};${keep}`
        const names = (named ?? '')
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean)
        const pairs = names.map((name) => {
          const [imported = '', local = imported] = name.split(/\s+as\s+/)
          if (!(imported in module))
            throw new CodeError(`${from} has no export "${imported}"`, line)
          return imported === local ? imported : `${imported}: ${local}`
        })
        return `const { ${pairs.join(', ')} } = ${source};${keep}`
      },
    )
    if (/^[ \t]*import\b/m.test(body)) {
      throw new CodeError(
        'Only named imports work here',
        lineAt(body, body.search(/^[ \t]*import\b/m)),
      )
    }
    const exported = body.search(/^[ \t]*export\s+default\s/m)
    if (exported < 0) throw new CodeError('The file must end in export default effect(…)')
    body = body.replace(/^([ \t]*)export\s+default\s/m, '$1return ')
    return `"use strict";${body}`
  }

  /** Line of a syntax error. `new Function` doesn't report it but a classic script does. */
  function locate(body: string): number | undefined {
    let line: number | undefined
    const listen = (e: ErrorEvent): void => {
      line = e.lineno - 1
      e.preventDefault()
    }
    addEventListener('error', listen)
    const script = document.createElement('script')
    script.textContent = `(function () {\n${body}\n})`
    document.head.append(script)
    script.remove()
    removeEventListener('error', listen)
    return line
  }

  /** Editor line of a runtime error, read off its stack. */
  function lineOf(error: unknown): number | undefined {
    const stack = error instanceof Error ? error.stack : undefined
    const m = stack && /ink-editor\.js:(\d+):\d+/.exec(stack)
    return m ? Number(m[1]) - HEADER : undefined
  }
  // sourceURL of the editor's code. `new Function` adds two lines above the body.
  const SOURCE = 'ink-editor.js'
  const HEADER = 2

  let version = 0
  // Last version seen drawing, the one running now, and when it was sent.
  let good: Effect | undefined
  let current: Effect | undefined
  let sent = 0
  let rebuilds = 0
  let drawnVersion = 0

  /** `effect` wrapped to notice the first update of version `v`, which means it drew. */
  function watched(v: number): typeof effect {
    return ((...args: unknown[]) => {
      const setup = args.at(-1)
      if (typeof setup === 'function') {
        args[args.length - 1] = (ctx: unknown) => {
          const first =
            (update: unknown) =>
            (...input: unknown[]): unknown => {
              // Skip the rehearsal, which runs on a stand-in element.
              if (drawnVersion !== v && (ctx as { element?: unknown }).element === picture) drew(v)
              return typeof update === 'function' ? update(...input) : undefined
            }
          const out: unknown = setup(ctx)
          return out instanceof Promise ? out.then(first) : first(out)
        }
      }
      return (effect as (...a: unknown[]) => Effect)(...args)
    }) as typeof effect
  }

  type Three = Awaited<ReturnType<typeof load>>

  /**
   * Dry-runs a version's setup, shader and first update on a stand-in off the page, so a broken
   * version throws here instead of taking the picture down. The shader compiles the way the
   * runtime would, unless the same graph was compiled before (say only a param default changed).
   */
  async function rehearse(next: Effect, { tsl, three }: Three): Promise<void> {
    const def = next['~definition']
    const box = picture?.getBoundingClientRect() ?? { x: 0, y: 0, width: 400, height: 500 }
    const spec = (def.params ?? {}) as Record<string, unknown>
    const vector = (v: readonly number[]) =>
      v.length === 2
        ? tsl.uniform(new three.Vector2(...v))
        : v.length === 3
          ? tsl.uniform(new three.Vector3(...v))
          : tsl.uniform(new three.Vector4(...v))
    const u: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(spec)) {
      if (typeof value === 'number' || typeof value === 'boolean')
        u[key] = tsl.uniform(Number(value))
      else if (Array.isArray(value)) u[key] = vector(value as number[])
      else if ((value as { '~kind'?: string })['~kind'] === 'color') {
        u[key] = tsl.uniform(new three.Color((value as { value: string }).value))
      }
    }
    for (const key of [
      'hover',
      'velocity',
      'progress',
      'pin',
      'time',
      'motion',
      'opacity',
      'presence',
    ]) {
      u[key] = tsl.uniform(0)
    }
    for (const key of ['pointer', 'pointerWorld']) u[key] = tsl.uniform(new three.Vector2(0.5, 0.5))
    u.size = tsl.uniform(new three.Vector2(box.width, box.height))
    const input = {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      visible: true,
      pointer: { x: 0.5, y: 0.5 },
      pointerWorld: { x: 0, y: 0 },
      over: false,
      hover: 0,
      velocity: 0,
      progress: 0.5,
      pin: 0,
      time: 0,
      delta: 0,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      opacity: 1,
      presence: 1,
    }
    // biome-ignore lint/suspicious/noExplicitAny: the editor calls what the visitor's code registered, untyped.
    type Transform = (...args: any[]) => any
    const transforms = {
      position: [] as Transform[],
      uv: [] as Transform[],
      color: [] as Transform[],
    }
    const add = (list: Transform[]) => (fn: Transform) => {
      list.push(fn)
      return () => {}
    }
    // Same texture setup as the real image (filtered, mipmapped) so the shader compiles the same.
    const map = new three.CanvasTexture(still())
    map.colorSpace = three.SRGBColorSpace
    const element = standIn()
    const scope = app.scope()
    const abort = new AbortController()
    const cleanups: (() => void)[] = []
    const ctx = {
      name: 'ink',
      element,
      params: strict({ ...next.defaults }, 'ctx.params'),
      u: strict(u, 'ctx.u'),
      input,
      layer: { element, input, root: new three.Group() },
      render: app.effects.render,
      app: scope,
      signal: abort.signal,
      onDispose: (fn: () => void) => {
        cleanups.push(fn)
        return () => {}
      },
      invalidate: () => {},
      surface: {
        segments: () => {},
        position: add(transforms.position),
        uv: add(transforms.uv),
        color: add(transforms.color),
      },
      map,
      coverUV: (at?: unknown) => at ?? tsl.uv(),
      mask: () => tsl.float(1),
      place: <T>(object: T) => object,
      viewport: new three.Group(),
      layers: () => [],
      pose: () => {},
      attach: () => Object.assign(() => {}, { detach() {}, instances: [] }),
    }
    // Lets a shader error point back to the line that built the node.
    const nodes = three.Node as unknown as { captureStackTrace: boolean }
    nodes.captureStackTrace = true
    try {
      const update: unknown = await def.setup(ctx as never)
      const at = tsl.uv()
      const position = transforms.position.reduce((p, fn) => fn(p, at), tsl.positionLocal)
      const bent = transforms.uv.reduce((v, fn) => fn(v), at)
      const sample = (p: unknown) => tsl.texture(map, p as never)
      const colour = transforms.color.reduce(
        (c, fn) => fn(c, { uv: bent, box: at, sample }),
        sample(bent),
      )
      await compile(position, colour, { tsl, three })
      if (typeof update === 'function') {
        update(input, {
          delta: 0,
          rawDelta: 0,
          elapsed: 0,
          now: performance.now(),
          frame: 0,
          resumed: false,
        })
      }
    } finally {
      nodes.captureStackTrace = false
      abort.abort()
      for (const fn of cleanups.reverse()) fn()
      scope.dispose()
      map.dispose()
    }
  }
  /**
   * Throws on unknown keys. The real `u` and `params` return undefined and the shader fails later
   * with no line to point at.
   */
  function strict<T extends object>(target: T, name: string): T {
    const params = Object.keys(target).filter((k) => !INPUTS.has(k))
    return new Proxy(target, {
      get(t, key, receiver) {
        if (typeof key === 'string' && !(key in t) && key !== 'then' && key !== 'toJSON') {
          throw new Error(`${name} has no "${key}": the params are ${params.join(', ')}`)
        }
        return Reflect.get(t, key, receiver)
      },
    })
  }
  const INPUTS = new Set([
    'hover',
    'velocity',
    'progress',
    'pin',
    'time',
    'motion',
    'opacity',
    'presence',
    'pointer',
    'pointerWorld',
    'size',
  ])
  const compiled = new Set<number>()
  interface Scope {
    pushErrorScope(filter: 'validation'): void
    popErrorScope(): Promise<{ message: string } | null>
  }
  const FAILURE = /^(THREE\.)?(TSL:|WebGPURenderer: Async render pipeline creation failed)/

  /** Compiles a throwaway mesh with these nodes and throws whatever three reports. */
  async function compile(
    position: unknown,
    colour: unknown,
    { tsl, three }: Pick<Three, 'tsl' | 'three'>,
  ): Promise<void> {
    const render = app.effects.render
    if (!render) return
    const material = new three.MeshBasicNodeMaterial({ transparent: true })
    material.positionNode = position as never
    material.colorNode = tsl.vec4(colour as never)
    const keyOf = (node: unknown) =>
      (node as { getCacheKey?: () => number }).getCacheKey?.() ?? Math.random()
    const key = keyOf(material.positionNode) * 31 + keyOf(material.colorNode)
    if (compiled.has(key)) return material.dispose()
    const mesh = new three.Mesh(new three.PlaneGeometry(), material)
    // r187 doesn't throw on compile errors. Listen on the same three channels the runtime uses.
    let failure: unknown
    const fail = (error: unknown): void => {
      failure ??= error
    }
    const log = three.getConsoleFunction()
    three.setConsoleFunction((type, message, ...rest) => {
      // These belong to the stand-in. Show them in the editor only, not in the console.
      if (type === 'error') {
        if (!FAILURE.test(message)) return fail(new Error(message.split('\n')[0]))
        const trace = rest[0] as { stack?: { file: string; line: number }[] } | undefined
        const frame = trace?.stack?.find((f) => f.file === SOURCE)
        const text = message.replace(/^THREE\./, '').replace(/ ".*?:\d+"$/, '')
        fail(new CodeError(text, frame ? frame.line - HEADER : undefined))
      } else if (log) log(type, message, ...rest)
      else console[type](message, ...rest)
    })
    const debug = render.renderer.debug as { onShaderError: ((...args: unknown[]) => void) | null }
    const shader = debug.onShaderError
    debug.onShaderError = () => fail(new Error('The shader does not compile'))
    // On WebGPU the WGSL validation message is the useful one. The error scope also keeps it off
    // the console.
    const device = (render.renderer.backend as { device?: Scope }).device
    device?.pushErrorScope('validation')
    try {
      await render.renderer.compileAsync(mesh, render.camera, render.scene)
    } catch (error) {
      fail(error)
    } finally {
      const gpu = await device?.popErrorScope()
      const wgsl = gpu && /error: (.+)/.exec(gpu.message)?.[1]
      if (gpu) failure = new CodeError(wgsl ? `WGSL: ${wgsl}` : (gpu.message.split('\n')[0] ?? ''))
      three.setConsoleFunction(log as Parameters<typeof three.setConsoleFunction>[0])
      debug.onShaderError = shader
      mesh.geometry.dispose()
      material.dispose()
    }
    if (failure) throw failure
    compiled.add(key)
  }

  const still = once(() => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 4, height: 4 })
    const g = canvas.getContext('2d')
    if (g) {
      g.fillStyle = '#806050'
      g.fillRect(0, 0, 4, 4)
    }
    return canvas
  })
  // Detached element, so the rehearsal can't touch the real picture.
  const standIn = once(() => {
    const img = new Image()
    img.src = picture?.currentSrc || picture?.src || ''
    return img
  })

  function drew(v: number): void {
    drawnVersion = v
    if (v !== version || !current) return
    good = current
    rebuilds++
    const ms = Math.round(performance.now() - sent)
    say('live', `Rebuilt in ${ms} ms, no reload`)
    showProblem(undefined)
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  /** Rebuilds after `ms`. A pending rebuild is kept unless `restart` or `ms` is 0. */
  function soon(ms: number, restart = false): void {
    if (timer !== undefined && !restart && ms > 0) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void apply(area?.value ?? '')
    }, ms)
  }

  let applied = file
  async function apply(code: string): Promise<void> {
    if (code === applied && current) return
    const v = ++version
    const modules = await load()
    const { shared, saved } = modules
    if (v !== version) return
    good ??= saved
    applied = code
    let next: Effect
    if (code === file) next = saved
    else {
      try {
        const imports = { ...shared, diorama: { effect: watched(v), color, oneOf } }
        const body = translate(code, imports)
        let run: (modules: Modules) => unknown
        try {
          run = new Function('__modules', `${body}\n//# sourceURL=${SOURCE}`) as typeof run
        } catch (error) {
          throw new CodeError(error instanceof Error ? error.message : String(error), locate(body))
        }
        const result = run(imports)
        if (typeof result !== 'function' || !('~definition' in result)) {
          throw new CodeError('export default must be an effect(…)')
        }
        next = result as Effect
        await rehearse(next, modules)
        if (v !== version) return
      } catch (error) {
        say('error', 'Kept the last good version')
        showProblem(error)
        return
      }
    }
    current = next
    sent = performance.now()
    say('building', 'Rebuilding…')
    swap(next)
    if (next === saved) {
      good = saved
      say('file', 'Running the file as saved')
      showProblem(undefined)
    }
  }

  function say(kind: string, text: string): void {
    if (!state) return
    state.dataset.state = kind
    const label = state.querySelector('.state-text')
    if (label) label.textContent = text
  }

  function showProblem(error: unknown): void {
    const span = problem?.querySelector('span')
    if (!problem || !span) return
    if (error === undefined) {
      problem.classList.remove('shown')
      problemLine = undefined
      render()
      return
    }
    const cause = (error as { cause?: unknown }).cause ?? error
    const message = (cause instanceof Error ? cause.message : String(cause)).split('\n')[0] ?? ''
    problemLine = error instanceof CodeError ? error.line : (lineOf(cause) ?? lineOf(error))
    span.innerHTML = `${problemLine ? `<b>Line ${problemLine}</b> · ` : ''}${escapeHtml(message)}`
    problem.classList.add('shown')
    render()
  }

  // If a version fails at runtime (setup, shader or update), fall back to the last good one. The
  // error stays on screen until the code changes.
  void ready(app).then(() => {
    if (!picture) return
    const watch = (): void => {
      const instance = app.effects.get(picture, 'ink')
      if (!instance) {
        setTimeout(watch, 200)
        return
      }
      instance.status.subscribe((status) => {
        if (status !== 'failed' || !current || current === good) return
        say('error', 'Failed, back to the last good one')
        showProblem(instance.error)
        current = good
        if (good) swap(good)
      })
    }
    watch()
  })

  if (area) {
    area.value = file
    area.addEventListener('input', () => {
      render()
      if (scrub) return
      say('editing', 'Editing…')
      soon(380, true)
    })
    area.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        soon(0, true)
      }
    })
    render()
  }
  resetButton?.addEventListener('click', () => {
    if (!area) return
    area.value = file
    problemLine = undefined
    render()
    soon(0, true)
  })

  room.querySelector('.again')?.addEventListener('click', () => {
    if (picture) void import('../../effects/_ink').then(({ rewet }) => rewet(picture))
  })
  const hint = room.querySelector<HTMLElement>('.hint')
  if (hint && !fine && hint.dataset.touch) hint.textContent = hint.dataset.touch
  const tip = room.querySelector<HTMLElement>('.tip')
  if (tip) tip.hidden = !fine

  // Frame meter. Samples three's render call count four times a second, the bars cover the last
  // 12 s. Diorama draws nothing when nothing changes, so an idle page reads 0.
  const BINS = 48
  const spark = room.querySelector<HTMLElement>('.spark')
  const fps = room.querySelector<HTMLElement>('.fps-n')
  const bars = Array.from({ length: BINS }, () => document.createElement('i'))
  spark?.replaceChildren(...bars)
  const counts = Object.fromEntries(
    [...room.querySelectorAll<HTMLElement>('[data-count]')].map((el) => [el.dataset.count, el]),
  )
  const history: number[] = Array.from({ length: BINS }, () => 0)
  let seen = -1
  const meter = setInterval(() => {
    const effects = app.state.value === 'running' ? app.effects : undefined
    const calls = effects?.render?.renderer.info.render.calls
    const drawn = calls === undefined || seen < 0 ? 0 : calls - seen
    if (calls !== undefined) seen = calls
    history.push(drawn)
    history.shift()
    const second = history.slice(-4).reduce((a, b) => a + b, 0)
    if (fps) fps.textContent = String(second)
    for (const [i, bar] of bars.entries()) {
      const n = history[i] ?? 0
      bar.style.height = `${Math.min(100, (n / 15) * 100)}%`
      bar.classList.toggle('on', n > 0)
    }
    const stats = effects?.stats()
    if (counts.layers) counts.layers.textContent = String(stats?.layers ?? 0)
    if (counts.textures) counts.textures.textContent = String(stats?.textures ?? 0)
    if (counts.rebuilds) counts.rebuilds.textContent = String(rebuilds)
  }, 250)

  return () => {
    off.abort()
    clearInterval(meter)
    clearTimeout(timer)
    // Put the saved file back so the page starts clean next time.
    if (current && good !== undefined)
      void load().then(({ saved }) => current !== saved && swap(saved))
  }
}
