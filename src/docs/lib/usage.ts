// Code variants of a live example: the markup as written, the same effect with
// `app.attach`, and with an imported effect. Deterministic, so the output is plain code.

import { PACKAGE } from '../site.ts'
import { kebab } from './check-markup.ts'
import { CODE_WIDTH } from './display.ts'

export type ParamValue = number | boolean | string | readonly number[]

export interface ParamControl {
  readonly name: string
  readonly type: 'number' | 'boolean' | 'color' | 'choice' | 'vector'
  readonly value: ParamValue
  readonly default: ParamValue
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly values?: readonly string[]
  readonly description?: string
}

export interface Markup {
  /** Selector of the first element with data-dio: its first class, its id or its tag. */
  readonly selector: string
  readonly effects: readonly string[]
  /** data-dio-* attributes of that element without the prefix, reserved ones included. */
  readonly attrs: ReadonlyMap<string, string>
}

export function readMarkup(html: string): Markup | undefined {
  for (const tag of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    const attrs = new Map<string, string>()
    for (const a of (tag[2] ?? '').matchAll(
      /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,
    )) {
      attrs.set((a[1] ?? '').toLowerCase(), a[2] ?? a[3] ?? a[4] ?? '')
    }
    const dio = attrs.get('data-dio')
    if (dio === undefined) continue
    const cls = attrs.get('class')?.split(/\s+/).find(Boolean)
    const id = attrs.get('id')
    const selector = cls ? `.${cls}` : id ? `#${id}` : (tag[1] ?? 'img')
    const params = new Map<string, string>()
    for (const [k, v] of attrs)
      if (k.startsWith('data-dio-')) params.set(k.slice('data-dio-'.length), v)
    return { selector, effects: dio.split(/\s+/).filter(Boolean), attrs: params }
  }
  return undefined
}

/** The markup value of a param: the addressed form wins over the short one. */
export function markupValue(markup: Markup, effect: string, param: string): string | undefined {
  return markup.attrs.get(`${effect}-${kebab(param)}`) ?? markup.attrs.get(kebab(param))
}

export function parseValue(raw: string, type: ParamControl['type']): ParamValue {
  if (type === 'number') return Number(raw)
  if (type === 'boolean') return raw === '' || raw === 'true'
  if (type === 'vector') return raw.split(/[\s,]+/).map(Number)
  return raw
}

export const literal = (v: ParamValue): string =>
  Array.isArray(v) ? `[${v.join(', ')}]` : typeof v === 'string' ? `'${v}'` : String(v)

/** Params as an object literal: on one line while the call fits the column, else one per line. */
const object = (controls: readonly ParamControl[], before: number): string => {
  if (!controls.length) return ''
  const pairs = controls.map((c) => `${c.name}: ${literal(c.value)}`)
  const flat = `{ ${pairs.join(', ')} }`
  return before + flat.length + 2 <= CODE_WIDTH
    ? flat
    : `{\n${pairs.map((p) => `  ${p},`).join('\n')}\n}`
}

export function attachCode(
  selector: string,
  effect: string,
  controls: readonly ParamControl[],
): string {
  const call = `app.attach('${selector}', '${effect}'`
  const params = object(controls, call.length + 2)
  return `import { start } from '${PACKAGE}'\n\nconst app = start()\n${call}${params ? `, ${params}` : ''})`
}

export function importCode(
  selector: string,
  effect: string,
  from: string,
  controls: readonly ParamControl[],
): string {
  const id = effect.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  const call = `app.attach('${selector}', ${id}(`
  return `import { start } from '${PACKAGE}'\nimport ${id} from '${from}'\n\nconst app = start()\n${call}${object(controls, call.length)}))`
}

/** Defaults of an own effect file: `effect({ amount: 1, tint: '#fff' }, …)`. */
export function ownDefaults(source: string): { name: string; value: ParamValue }[] {
  const body = /effect\(\s*\{([^}]*)\}/.exec(source)?.[1] ?? ''
  return [...body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(\[[^\]]*\]|'[^']*'|"[^"]*"|[^,]+)/g)].map(
    (m) => {
      const raw = (m[2] ?? '').trim()
      const value: ParamValue = /^(true|false)$/.test(raw)
        ? raw === 'true'
        : /^-?[\d.]+$/.test(raw)
          ? Number(raw)
          : raw.startsWith('[')
            ? raw.slice(1, -1).split(',').map(Number)
            : raw.replace(/^['"]|['"]$/g, '')
      return { name: m[1] ?? '', value }
    },
  )
}

/** The command that copies a built-in's source into the site's effects folder. */
export const addCommand = (name: string): string => `npx ${PACKAGE} add ${name}`
