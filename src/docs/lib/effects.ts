// What the effect pages and the gallery build from the library metadata.
// Pure: the data is passed in, so pages, twins and unit tests share it.
import { PACKAGE } from '../site.ts'
import { CATEGORIES, categorize, categoryTitle } from './categories.ts'
import { EVERY_DEVICE, FRAMES, MOTION, onlyWhere, TOUCH_SKIPPED } from './phrases.ts'

export type Tier = 'low' | 'medium' | 'high'

export interface ParamMeta {
  readonly name: string
  readonly attribute: string
  readonly type: 'number' | 'boolean' | 'color' | 'string' | 'choice' | 'vec2' | 'vec3' | 'vec4'
  readonly default: number | boolean | string | readonly number[]
  readonly values?: readonly string[]
  readonly live: boolean
  readonly preload?: boolean
  readonly caps?: Partial<Record<Tier, number>>
  readonly description: string
  readonly range?: readonly [number, number]
  readonly step?: number
  readonly unit?: string
}

export interface EffectMeta {
  readonly name: string
  readonly module: string
  readonly package: string
  readonly import: string
  readonly builtIn: boolean
  readonly source: string
  readonly summary: string
  readonly looks?: string
  readonly target?: string
  readonly on?: string
  readonly media?: boolean
  readonly category?: string
  readonly tags?: readonly string[]
  readonly params: readonly ParamMeta[]
  readonly inputs: readonly string[]
  readonly frames: { readonly policy: string; readonly note?: string }
  readonly when?: string
  readonly reducedMotion: { readonly mode: 'static' | 'off'; readonly note?: string }
  readonly presence?: { readonly mode: string; readonly note?: string }
  readonly touch?: string
  readonly quality?: { readonly min?: Tier; readonly notes?: Partial<Record<Tier, string>> }
  readonly cost?: {
    readonly gpu?: string
    readonly memory?: string
    readonly chunk: number
    readonly data?: number
  }
  readonly examples?: readonly {
    readonly title: string
    readonly html: string
    readonly ts?: string
  }[]
  readonly events?: readonly {
    readonly name: string
    readonly description: string
    readonly detail: string
  }[]
  readonly children?: readonly {
    readonly attribute?: string
    readonly element?: string
    readonly description: string
  }[]
  readonly parts?: readonly { readonly name: string; readonly description: string }[]
  readonly credits?: string
}

/** Title and lede of the gallery page and its twin. */
export const GALLERY = {
  title: 'Effects',
  description:
    'Every ready-made effect of Diorama by what it animates, with a live preview under the pointer.',
} as const

/** Keys of a variant, in the order the switcher lists them. */
export const VARIANT_KEYS = ['style', 'motion', 'mode', 'by', 'trigger'] as const

/**
 * Cost class for the gallery filter. The metadata has no class of its own yet (every effect runs
 * on the low tier), so the class is what the frame policy costs: an effect that idles at rest
 * against one that keeps drawing while it is on screen.
 */
export type CostClass = 'idle' | 'continuous'
export const COST_CLASSES: readonly { readonly value: CostClass; readonly label: string }[] = [
  { value: 'idle', label: 'Idle at rest' },
  { value: 'continuous', label: 'Draws while on screen' },
]
export const costClass = (e: Pick<EffectMeta, 'frames'>): CostClass =>
  e.frames.policy === 'fps' || e.frames.policy === 'visible' ? 'continuous' : 'idle'

export interface EffectInfo {
  readonly meta: EffectMeta
  readonly name: string
  readonly url: string
  readonly category: string
  readonly categoryTitle: string
  readonly tags: readonly string[]
  readonly cost: CostClass
  /** No `when`: touch devices run it too. */
  readonly touch: boolean
  /** Draws a still frame under reduced motion instead of turning off. */
  readonly staticMotion: boolean
}

export function effectInfo(meta: EffectMeta): EffectInfo {
  const c = categorize(meta)
  if (!c) throw new Error(`effect ${meta.name} has no category`)
  return {
    meta,
    name: meta.name,
    url: `/docs/effects/${meta.name}`,
    category: c.category,
    categoryTitle: categoryTitle(c.category),
    tags: c.tags,
    cost: costClass(meta),
    touch: !meta.when,
    staticMotion: meta.reducedMotion.mode === 'static',
  }
}

/** Effects in category order, by name inside a category. */
export function effectList(metas: readonly EffectMeta[]): EffectInfo[] {
  const order = (slug: string) => CATEGORIES.findIndex((c) => c.slug === slug)
  return metas
    .map(effectInfo)
    .sort((a, b) => order(a.category) - order(b.category) || a.name.localeCompare(b.name))
}

/** Categories that hold at least one effect, with their effects. */
export function byCategory(
  list: readonly EffectInfo[],
): { slug: string; title: string; blurb: string; effects: EffectInfo[] }[] {
  return CATEGORIES.map((c) => ({
    ...c,
    effects: list.filter((e) => e.category === c.slug),
  })).filter((c) => c.effects.length)
}

// Values

export const literal = (v: ParamMeta['default']): string =>
  Array.isArray(v) ? `[${v.join(', ')}]` : typeof v === 'string' ? `'${v}'` : String(v)

export function typeLabel(p: ParamMeta): string {
  if (p.type === 'choice') return (p.values ?? []).map((v) => `'${v}'`).join(' | ')
  if (p.type === 'number' && p.default === 'auto') return "number | 'auto'"
  if (p.type.startsWith('vec'))
    return `[${Array.from({ length: Number(p.type.slice(3)) }, () => 'number').join(', ')}]`
  return p.type
}

const UNIT: Readonly<Record<string, string>> = { fraction: '', s: ' s', px: ' px', deg: '°' }
const unitText = (unit?: string): string => (unit === undefined ? '' : (UNIT[unit] ?? ` ${unit}`))

/** '0.2 to 3 s' from range and unit, or undefined without a range. */
export function rangeLabel(p: ParamMeta): string | undefined {
  if (!p.range) return undefined
  return `${p.range[0]} to ${p.range[1]}${unitText(p.unit)}`
}

/** 'low 15, medium 24': upper bounds by quality tier. */
export function capsLabel(p: ParamMeta): string | undefined {
  const caps = Object.entries(p.caps ?? {})
  return caps.length ? caps.map(([tier, v]) => `${tier} ${v}`).join(', ') : undefined
}

export interface ParamRow {
  readonly id: string
  readonly name: string
  readonly attribute: string
  readonly type: string
  readonly default: string
  readonly range?: string
  readonly caps?: string
  readonly description: string
  /** Changing it re-runs setup. */
  readonly rebuild: boolean
}

export function paramRows(e: Pick<EffectMeta, 'params'>): ParamRow[] {
  return e.params.map((p) => ({
    id: `param-${p.name}`,
    name: p.name,
    attribute: p.attribute,
    type: typeLabel(p),
    default: literal(p.default),
    range: rangeLabel(p),
    caps: capsLabel(p),
    description: p.description,
    rebuild: !p.live,
  }))
}

// Variants

/** Choice params: the variant keys first, in their order, then the rest in definition order. */
export function variantParams(e: Pick<EffectMeta, 'params'>): ParamMeta[] {
  const choices = e.params.filter((p) => p.type === 'choice' && p.values?.length)
  const rank = (p: ParamMeta) => {
    const i = (VARIANT_KEYS as readonly string[]).indexOf(p.name)
    return i < 0 ? VARIANT_KEYS.length : i
  }
  return choices
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
    .map(({ p }) => p)
}

/**
 * What each value of a choice does, read from its description while values have no field of
 * their own: 'wipe uncovers it…; fade fades it in…' gives { wipe: 'uncovers it….', fade: … }.
 * Empty unless at least two values are described.
 */
export function valueNotes(
  p: Pick<ParamMeta, 'type' | 'values' | 'description'>,
): Record<string, string> {
  const values = p.type === 'choice' ? (p.values ?? []) : []
  if (!values.length) return {}
  const starts = (text: string, v: string) => new RegExp(`^${v}[\\s,]`).test(text)
  let text = p.description.trim()
  // A lead-in before a colon speaks of the param: 'How the arcs move: draw draws…'.
  const lead = /^[^;:]*:\s+/.exec(text)
  if (lead && !values.some((v) => starts(text, v))) text = text.slice(lead[0].length)
  const out: Record<string, string> = {}
  for (const part of text.split(/;\s+/)) {
    const v = values.find((x) => starts(part, x))
    if (!v || v in out) continue
    const rest = part
      .slice(v.length)
      .replace(/^[\s,]+/, '')
      .trim()
    out[v] = /[.!?]$/.test(rest) ? rest : `${rest}.`
  }
  return Object.keys(out).length >= 2 ? out : {}
}

// Facts

export function framesPhrase(e: Pick<EffectMeta, 'frames'>): string {
  const phrase = FRAMES[e.frames.policy]
  if (!phrase)
    throw new Error(`no phrase for frame policy "${e.frames.policy}" (src/docs/lib/phrases.ts)`)
  return phrase
}

export function motionPhrase(e: Pick<EffectMeta, 'reducedMotion'>): string {
  const phrase = MOTION[e.reducedMotion.mode]
  if (!phrase) throw new Error(`no phrase for reduced motion "${e.reducedMotion.mode}"`)
  return phrase
}

export function touchPhrase(e: Pick<EffectMeta, 'when'>): string {
  if (!e.when) return EVERY_DEVICE
  return /hover/.test(e.when) ? TOUCH_SKIPPED : onlyWhere(e.when)
}

/** `start()` call that turns the effect's device or reduced-motion rule around. */
export function overrideCode(e: Pick<EffectMeta, 'name' | 'when' | 'reducedMotion'>): string {
  const key = /^[a-z][a-z0-9]*$/.test(e.name) ? e.name : `'${e.name}'`
  const patch = [
    e.when ? `when: 'all'` : undefined,
    e.reducedMotion.mode === 'off' ? `reducedMotion: 'static'` : `reducedMotion: 'off'`,
  ]
    .filter(Boolean)
    .join(', ')
  return `import { start } from '${PACKAGE}'\n\nstart({ effects: { ${key}: { ${patch} } } })`
}

/** Kilobytes with one decimal, as the size checks print them. */
export const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`

/** Shader node inputs link to their entry, numbers of `input` to theirs. */
export function inputHref(name: string, shaderInputs: ReadonlySet<string>): string {
  return `/docs/api/inputs#${shaderInputs.has(name) ? name : `input-${name}`}`
}

/** Effects that share the category, then those that share any category or tag. */
export function relatedEffects(e: EffectInfo, all: readonly EffectInfo[], limit = 8): EffectInfo[] {
  const mine = new Set([e.category, ...e.tags])
  const shared = (o: EffectInfo) =>
    o.category === e.category ? 2 : [o.category, ...o.tags].some((c) => mine.has(c)) ? 1 : 0
  return all
    .filter((o) => o.name !== e.name && shared(o) > 0)
    .sort((a, b) => shared(b) - shared(a) || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** Source link of the definition in the library repository. */
export const sourceUrl = (e: Pick<EffectMeta, 'source'>, repo: string, ref: string): string =>
  `${repo}/blob/${ref}/${e.source}`

// Markdown twin

const cell = (text: string) => text.replaceAll('|', '\\|').replace(/\s+/g, ' ').trim()

export function paramsMarkdown(e: Pick<EffectMeta, 'params'>): string {
  const rows = paramRows(e)
  if (!rows.length) return 'It has no params.'
  const lines = [
    '| Name | Attribute | Type | Default | Description |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| \`${r.name}\`${r.rebuild ? ' (rebuilds)' : ''} | \`${r.attribute}\` | ${cell(`\`${r.type}\``)}${r.range ? ` ${r.range}` : ''} | ${cell(`\`${r.default}\``)} | ${cell(r.description)}${r.caps ? ` At most ${r.caps}.` : ''} |`,
    ),
  ]
  const rebuild = rows.some((r) => r.rebuild)
    ? '\n\nChanging a param marked rebuilds re-runs the effect setup.'
    : ''
  return `${lines.join('\n')}${rebuild}`
}

export interface TwinParts {
  /** Markdown of the live example: its description and files, or empty. */
  readonly example: string
  /** Twin of the hand-written MDX: recipes and notes. */
  readonly body: string
  readonly shaderInputs: ReadonlySet<string>
  readonly related: readonly EffectInfo[]
  readonly guides: readonly { readonly url: string; readonly label: string }[]
  readonly source: string
}

export function effectMarkdown(info: EffectInfo, parts: TwinParts): string {
  const e = info.meta
  const out: string[] = [`# ${e.name}`, e.summary]
  if (e.looks) out.push(e.looks)
  out.push(
    `Module \`${e.module}\`, category ${info.categoryTitle}. Import \`${e.import}\`. [Source](${parts.source})`,
  )
  if (parts.example) out.push(parts.example)
  const usage = [`## Usage`]
  if (e.target) usage.push(`Put it on: ${e.target}.`)
  usage.push(
    e.builtIn
      ? `\`start()\` registers \`${e.name}\`, so the attribute alone puts it on an element.`
      : `Register it with \`start({ effects: { ${e.name} } })\` after \`import ${e.name} from '${e.import}'\`.`,
  )
  const first = e.examples?.[0]
  if (first) usage.push(`\`\`\`html\n${first.html}\n\`\`\``)
  for (const c of e.children ?? [])
    usage.push(
      `- ${c.attribute ? `\`${c.attribute}\`` : `\`${c.element}\` inside`}: ${c.description}`,
    )
  if (e.presence?.note) usage.push(`In page transitions: ${e.presence.note}`)
  for (const ev of e.events ?? [])
    usage.push(`- Event \`${ev.name}\`, detail \`${ev.detail}\`: ${ev.description}`)
  out.push(usage.join('\n\n'))
  out.push(`## Params\n\n${paramsMarkdown(e)}`)
  const variants = variantParams(e)
  if (variants.length) {
    const lines = variants.flatMap((p) => {
      const notes = valueNotes(p)
      return [
        `- \`${p.name}\`: ${(p.values ?? []).map((v) => `\`${v}\``).join(', ')}`,
        ...Object.entries(notes).map(([v, n]) => `  - \`${v}\` ${n}`),
      ]
    })
    out.push(`### Variants\n\n${lines.join('\n')}`)
  }
  const inputs = e.inputs.map((i) => `[\`${i}\`](${inputHref(i, parts.shaderInputs)})`).join(', ')
  out.push(
    `## Inputs and frames\n\n${inputs ? `Reads ${inputs}. ` : ''}${framesPhrase(e)}${e.frames.note ? ` ${e.frames.note}` : ''} See [how a frame is decided](/docs/concepts/frames).`,
  )
  out.push(
    `## Reduced motion and touch\n\n${motionPhrase(e)}${e.reducedMotion.note ? ` ${e.reducedMotion.note}` : ''}\n\n${touchPhrase(e)}${e.touch ? ` ${e.touch}` : ''}\n\n\`\`\`ts\n${overrideCode(e)}\n\`\`\``,
  )
  const cost: string[] = []
  if (e.cost)
    cost.push(
      `Loads ${kb(e.cost.chunk)} the first time a page uses it${e.cost.data ? `, ${kb(e.cost.data)} of it data` : ''}.${e.cost.gpu ? ` GPU: ${e.cost.gpu}` : ''}${e.cost.memory ? ` Memory: ${e.cost.memory}` : ''}`,
    )
  const notes = Object.entries(e.quality?.notes ?? {})
  if (notes.length) cost.push(notes.map(([t, n]) => `- ${t}: ${n}`).join('\n'))
  cost.push('See [the quality plugin](/docs/effects/quality).')
  out.push(`## Cost and quality\n\n${cost.join('\n\n')}`)
  if (parts.body.trim()) out.push(parts.body.trim())
  if (e.credits) out.push(`## Credits\n\n${e.credits}`)
  const related = [
    ...parts.related.map((r) => `- [${r.name}](${r.url}.md): ${r.meta.summary}`),
    ...parts.guides.map((g) => `- [${g.label}](${g.url}.md)`),
  ]
  if (related.length) out.push(`## Related\n\n${related.join('\n')}`)
  return `${out.join('\n\n')}\n`
}
