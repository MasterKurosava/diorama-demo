// Writes src/generated/effects.json from the meta.json files of the linked library's effect
// modules. The site never derives metadata itself: a missing required field fails the build.
// Without any meta.json yet the file says `pending` and checks that need it are skipped.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkCategory } from '../src/docs/lib/categories.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const packages = resolve(realpathSync(join(root, 'node_modules/dioramajs')), '..')

const REQUIRED = [
  'name',
  'module',
  'package',
  'import',
  'builtIn',
  'source',
  'summary',
  'params',
  'inputs',
  'frames',
  'reducedMotion',
]
const PARAM = ['name', 'attribute', 'type', 'live', 'description']
const TYPES = ['number', 'boolean', 'color', 'string', 'choice', 'vec2', 'vec3', 'vec4']
const missing = (value) => value === undefined || value === null || value === ''
const text = (value) => typeof value === 'string' && value.trim() !== ''

/** Why `p.default` does not fit `p.type`, or undefined. An empty string is a real default. */
function badDefault(p) {
  const d = p.default
  if (d === undefined || d === null) return 'is missing'
  switch (p.type) {
    case 'number':
      // 'auto': the effect picks the value (a number param that may also be 'auto').
      return Number.isFinite(d) || d === 'auto' ? undefined : 'is not a number'
    case 'boolean':
      return typeof d === 'boolean' ? undefined : 'is not a boolean'
    case 'color':
      return text(d) ? undefined : 'is not a colour'
    case 'string':
      return typeof d === 'string' ? undefined : 'is not a string'
    case 'choice':
      return Array.isArray(p.values) && p.values.includes(d) ? undefined : 'is not one of values'
    default: {
      const size = Number(p.type.slice(3))
      return Array.isArray(d) && d.length === size && d.every(Number.isFinite)
        ? undefined
        : `is not ${size} numbers`
    }
  }
}

export function validate(effect, where) {
  const problems = []
  for (const key of REQUIRED) if (missing(effect[key])) problems.push(`${where}: ${key} is missing`)
  for (const [i, p] of (effect.params ?? []).entries()) {
    const at = `${where}: params[${i}]`
    for (const key of PARAM) if (missing(p[key])) problems.push(`${at}.${key} is missing`)
    if (missing(p.type)) continue
    if (!TYPES.includes(p.type)) problems.push(`${at}.type "${p.type}" is unknown`)
    else {
      const bad = badDefault(p)
      if (bad) problems.push(`${at}.default ${bad}`)
      if (
        p.type === 'choice' &&
        !(Array.isArray(p.values) && p.values.length && p.values.every(text))
      )
        problems.push(`${at}.values is missing`)
    }
  }
  const cost = effect.cost
  if (
    cost !== undefined &&
    (!Number.isFinite(cost.chunk) || (cost.data !== undefined && !Number.isFinite(cost.data)))
  )
    problems.push(`${where}: cost.chunk and cost.data must be numbers`)
  for (const [i, e] of (effect.events ?? []).entries()) {
    if (!/^dio:[a-z][a-z0-9-]*$/.test(e.name ?? ''))
      problems.push(`${where}: events[${i}].name is not dio:<name>`)
    for (const key of ['description', 'detail'])
      if (!text(e[key])) problems.push(`${where}: events[${i}].${key} is missing`)
  }
  // A child is an attribute the effect reads or a child element it reads or drives.
  for (const [i, c] of (effect.children ?? []).entries()) {
    const ok =
      c.element === undefined
        ? /^data-[a-z0-9-]+$/.test(c.attribute ?? '')
        : text(c.element) && c.attribute === undefined
    if (!ok)
      problems.push(`${where}: children[${i}] needs a data-* attribute or an element selector`)
    if (!text(c.description)) problems.push(`${where}: children[${i}].description is missing`)
  }
  for (const p of checkCategory(effect)) problems.push(`${where}: ${p}`)
  if (effect.credits !== undefined && !text(effect.credits))
    problems.push(`${where}: credits is empty`)
  return problems
}

export function main() {
  const effects = []
  const problems = []
  const sources = []
  for (const dir of readdirSync(packages)) {
    const file = join(packages, dir, 'meta.json')
    if (!existsSync(file)) continue
    sources.push(dir)
    const json = JSON.parse(readFileSync(file, 'utf8'))
    const list = Array.isArray(json) ? json : (json.effects ?? [])
    for (const effect of list) {
      problems.push(...validate(effect, `${dir}/meta.json ${effect.name ?? '?'}`))
      effects.push(effect)
    }
  }
  const names = effects.map((e) => e.name)
  for (const name of new Set(names.filter((n, i) => names.indexOf(n) !== i)))
    problems.push(`effect "${name}" is described twice`)
  if (problems.length) {
    console.error(`meta: ${problems.length} problems\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  mkdirSync(join(root, 'src/generated'), { recursive: true })
  const pending = sources.length === 0
  writeFileSync(join(root, 'src/generated/effects.json'), JSON.stringify({ pending, effects }))
  console.log(
    pending
      ? 'meta: no meta.json in the library yet, effect checks wait for it'
      : `meta: ${effects.length} effects from ${sources.join(', ')}`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
