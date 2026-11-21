// Writes src/generated/api.json and symbols.json from TypeDoc over the linked library sources.
// `--strict` (or API_STRICT=1) fails on exports without a description (AP1).
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Application, ReflectionKind } from 'typedoc'
import { REPO, REPO_REF } from '../src/docs/site.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const posix = (path) => path.replaceAll('\\', '/')
const library = posix(resolve(realpathSync(join(root, 'node_modules/dioramajs')), '../..'))
const strict = process.argv.includes('--strict') || process.env.API_STRICT === '1'
const out = join(root, 'src/generated')

// Entries the reference does not publish.
const HIDDEN = new Set([
  'dioramajs/generated',
  '@dioramajs/effects/runtime',
  '@dioramajs/glsl/client',
  '@dioramajs/media/image',
  '@dioramajs/media/ripple',
  '@dioramajs/media/bend',
])
const LOW_LEVEL = new Set(['core', 'render', 'effects', 'effects-effect'])

/** Canonical order: the first module that exports a symbol owns its page. */
function rank(specifier) {
  if (specifier === 'dioramajs') return 0
  if (specifier.startsWith('dioramajs/')) return 1
  if (specifier === '@dioramajs/effects') return 2
  if (specifier === '@dioramajs/core') return 3
  return 4
}

export function slugOf(specifier) {
  // Pages keep the brand: `dioramajs/vite` is /docs/api/diorama-vite.
  return specifier
    .replace(/^@dioramajs\//, '')
    .replace(/^dioramajs(?=\/|$)/, 'diorama')
    .replaceAll('/', '-')
}

export function kebab(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function entries() {
  const list = []
  for (const dir of readdirSync(join(library, 'packages'))) {
    if (dir === 'interop') continue
    const pkg = JSON.parse(readFileSync(join(library, 'packages', dir, 'package.json'), 'utf8'))
    for (const [sub, target] of Object.entries(pkg.exports ?? {})) {
      const source = typeof target === 'object' ? target['@dioramajs/source'] : undefined
      if (!source) continue
      const specifier = sub === '.' ? pkg.name : `${pkg.name}/${sub.slice(2)}`
      if (HIDDEN.has(specifier)) continue
      list.push({
        specifier,
        package: pkg.name,
        file: posix(join(library, 'packages', dir, source)),
      })
    }
  }
  return list.sort(
    (a, b) => rank(a.specifier) - rank(b.specifier) || a.specifier.localeCompare(b.specifier),
  )
}

async function convert(list) {
  const cache = join(root, 'node_modules/.cache/diorama-api')
  mkdirSync(cache, { recursive: true })
  const tsconfig = join(cache, 'tsconfig.json')
  writeFileSync(
    tsconfig,
    JSON.stringify({
      extends: join(library, 'tsconfig.base.json'),
      compilerOptions: { types: ['node'], typeRoots: [join(library, 'node_modules/@types')] },
      files: list.map((e) => e.file),
    }),
  )
  const app = await Application.bootstrapWithPlugins({
    entryPoints: list.map((e) => e.file),
    entryPointStrategy: 'resolve',
    tsconfig,
    basePath: library,
    disableGit: true,
    sourceLinkTemplate: `${REPO}/blob/${REPO_REF}/{path}#L{line}`,
    excludeInternal: true,
    excludePrivate: true,
    excludeProtected: true,
    excludeNotDocumented: false,
    // The library type-checks with TypeScript 7; TypeDoc runs on 6 and only needs the shapes.
    skipErrorChecking: true,
    sort: ['kind', 'alphabetical'],
    validation: { notExported: false, invalidLink: false, notDocumented: false },
    logLevel: 'Warn',
  })
  const project = await app.convert()
  if (!project) throw new Error('TypeDoc failed to convert the library')
  return app.serializer.projectToObject(project, library)
}

const K = ReflectionKind
const TYPE_KINDS = K.Interface | K.TypeAlias | K.Enum
const MEMBER_KINDS = K.Property | K.Method | K.Accessor | K.Constructor

function kindName(kind) {
  if (kind & K.Function) return 'function'
  if (kind & K.Class) return 'class'
  if (kind & K.Interface) return 'interface'
  if (kind & K.TypeAlias) return 'type'
  if (kind & K.Enum) return 'enum'
  if (kind & K.Namespace) return 'namespace'
  if (kind & K.Variable) return 'const'
  return 'other'
}

/** TSDoc display parts to Markdown. `{@link X}` becomes inline code, which autolinks. */
export function partsToMd(parts = []) {
  return parts
    .map((p) => {
      if (p.kind === 'inline-tag') return `\`${(p.text || '').trim()}\``
      return p.text
    })
    .join('')
    .trim()
}

function build(json, list) {
  const byId = new Map()
  const walk = (node, parent) => {
    if (!node || typeof node !== 'object') return
    if (typeof node.id === 'number' && node.kind !== undefined) {
      byId.set(node.id, node)
      node.__parent = parent
    }
    for (const child of node.children ?? []) walk(child, node)
    for (const sig of node.signatures ?? []) walk(sig, node)
  }
  walk(json)

  const modules = []
  const symbols = new Map()
  const exporters = new Map()
  const undocumented = []
  const order = (specifier) => list.findIndex((e) => e.specifier === specifier)
  const moduleNodes = json.children?.length && json.children[0].kind & K.Module ? json.children : []
  const pairs = []
  for (const mod of moduleNodes) {
    const file = mod.sources?.[0]?.fileName
    const entry = list.find((e) => file && e.file.endsWith(`/${file}`))
    if (!entry) continue
    const slug = slugOf(entry.specifier)
    const record = {
      slug,
      specifier: entry.specifier,
      package: entry.package,
      lowLevel: LOW_LEVEL.has(slug),
      summary: partsToMd(mod.comment?.summary),
      symbols: [],
    }
    modules.push(record)
    pairs.push([mod, record])
  }
  modules.sort((a, b) => order(a.specifier) - order(b.specifier))
  for (const [mod, record] of pairs) {
    for (const child of mod.children ?? []) {
      if (child.kind & K.Reference || child.name.startsWith('~')) continue
      symbols.set(child.id, symbolOf(child, record))
      exporters.set(child.id, [record])
    }
  }
  // Re-exports point at the declaration; the first module in canonical order owns the page.
  for (const [mod, record] of pairs) {
    for (const child of mod.children ?? []) {
      if (!(child.kind & K.Reference)) continue
      let target = child.target
      while (byId.get(target)?.kind & K.Reference) target = byId.get(target).target
      if (!symbols.has(target) || symbols.get(target).name !== child.name) continue
      exporters.get(target).push(record)
    }
  }
  for (const [id, records] of exporters) {
    records.sort((a, b) => order(a.specifier) - order(b.specifier))
    const [owner, ...rest] = records
    const sym = symbols.get(id)
    sym.module = owner.slug
    sym.specifier = owner.specifier
    sym.url = `/docs/api/${owner.slug}/${sym.__node.kind & TYPE_KINDS ? 'types/' : ''}${kebab(sym.name)}`
    sym.also = [...new Set(rest.map((r) => r.specifier))]
    for (const r of records) r.symbols.push(id)
  }
  // `docsUrl` and `DOCS_URL` share a path: the later kind in this order gets a suffix.
  const taken = new Map()
  const KIND_ORDER = [
    'function',
    'class',
    'interface',
    'type',
    'enum',
    'namespace',
    'const',
    'other',
  ]
  const sorted = [...symbols.values()].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id - b.id,
  )
  for (const sym of sorted) {
    const key = sym.url.toLowerCase()
    if (taken.has(key)) sym.url = `${sym.url}-${sym.kind}`
    taken.set(sym.url.toLowerCase(), sym)
  }

  function symbolOf(node, mod) {
    const kind = kindName(node.kind)
    const comment = node.comment ?? node.signatures?.[0]?.comment
    const summary = partsToMd(comment?.summary)
    if (!summary) undocumented.push(`${mod.specifier}:${node.name}`)
    const tags = comment?.blockTags ?? []
    return {
      id: node.id,
      name: node.name,
      kind,
      module: mod.slug,
      specifier: mod.specifier,
      url: '',
      summary,
      examples: tags.filter((t) => t.tag === '@example').map((t) => partsToMd(t.content)),
      throws: tags.filter((t) => t.tag === '@throws').map((t) => partsToMd(t.content)),
      deprecated: tags.some((t) => t.tag === '@deprecated'),
      also: [],
      source: node.sources?.[0]
        ? {
            file: node.sources[0].fileName,
            line: node.sources[0].line,
            url: `${REPO}/blob/${REPO_REF}/${node.sources[0].fileName}#L${node.sources[0].line}`,
          }
        : undefined,
      __node: node,
    }
  }

  const urlOf = (id) => {
    const sym = symbols.get(id)
    if (sym) return sym.url
    const node = byId.get(id)
    const parent = node?.__parent
    if (parent && symbols.get(parent.id)) return `${symbols.get(parent.id).url}#${node.name}`
    return undefined
  }

  // Types as token lists: [text, kind?, href?]. Kinds: k keyword, s string, n number, t type.
  const tok = (text, kind, href) =>
    href ? [text, kind ?? 't', href] : kind ? [text, kind] : [text]
  function typeTokens(type, depth = 0) {
    if (!type) return [tok('unknown', 'k')]
    switch (type.type) {
      case 'intrinsic':
        return [tok(type.name, 'k')]
      case 'literal':
        if (type.value === null) return [tok('null', 'k')]
        if (typeof type.value === 'string') return [tok(`'${type.value}'`, 's')]
        if (typeof type.value === 'object')
          return [tok(`${type.value.negative ? '-' : ''}${type.value.value}n`, 'n')]
        return [tok(String(type.value), typeof type.value === 'number' ? 'n' : 'k')]
      case 'reference': {
        const href = typeof type.target === 'number' ? urlOf(type.target) : undefined
        const out = [tok(type.name, 't', href)]
        if (type.typeArguments?.length) {
          out.push(tok('<'))
          type.typeArguments.forEach((arg, i) => {
            if (i) out.push(tok(', '))
            out.push(...typeTokens(arg, depth + 1))
          })
          out.push(tok('>'))
        }
        return out
      }
      case 'union': {
        const members = type.types.map((t) => typeTokens(t, depth + 1))
        const literal = type.types.every((t) => t.type === 'literal')
        const shown = literal && members.length > 6 ? members.slice(0, 6) : members
        const out = []
        shown.forEach((m, i) => {
          if (i) out.push(tok(' | '))
          out.push(...m)
        })
        if (shown.length < members.length) {
          const rest = []
          for (const m of members.slice(6)) rest.push(tok(' | '), ...m)
          out.push({ more: members.length - 6, tokens: rest })
        }
        return out
      }
      case 'intersection': {
        const out = []
        type.types.forEach((t, i) => {
          if (i) out.push(tok(' & '))
          out.push(...typeTokens(t, depth + 1))
        })
        return out
      }
      case 'array': {
        const inner = typeTokens(type.elementType, depth + 1)
        const wrap = ['union', 'intersection', 'reflection'].includes(type.elementType.type)
        return wrap ? [tok('('), ...inner, tok(')[]')] : [...inner, tok('[]')]
      }
      case 'tuple': {
        const out = [tok('[')]
        ;(type.elements ?? []).forEach((t, i) => {
          if (i) out.push(tok(', '))
          out.push(...typeTokens(t, depth + 1))
        })
        out.push(tok(']'))
        return out
      }
      case 'namedTupleMember':
        return [
          tok(`${type.name}${type.isOptional ? '?' : ''}: `),
          ...typeTokens(type.element, depth + 1),
        ]
      case 'optional':
        return [...typeTokens(type.elementType, depth + 1), tok('?')]
      case 'rest':
        return [tok('...'), ...typeTokens(type.elementType, depth + 1)]
      case 'query':
        return [tok('typeof ', 'k'), ...typeTokens(type.queryType, depth + 1)]
      case 'typeOperator':
        return [tok(`${type.operator} `, 'k'), ...typeTokens(type.target, depth + 1)]
      case 'indexedAccess':
        return [
          ...typeTokens(type.objectType, depth + 1),
          tok('['),
          ...typeTokens(type.indexType, depth + 1),
          tok(']'),
        ]
      case 'conditional':
        return [
          ...typeTokens(type.checkType, depth + 1),
          tok(' extends ', 'k'),
          ...typeTokens(type.extendsType, depth + 1),
          tok(' ? '),
          ...typeTokens(type.trueType, depth + 1),
          tok(' : '),
          ...typeTokens(type.falseType, depth + 1),
        ]
      case 'mapped':
        return [
          tok('{ '),
          tok(`[${type.parameter} in `),
          ...typeTokens(type.parameterType, depth + 1),
          tok(']: '),
          ...typeTokens(type.templateType, depth + 1),
          tok(' }'),
        ]
      case 'templateLiteral': {
        const out = [tok('`' + type.head, 's')]
        for (const [t, text] of type.tail)
          out.push(tok('${'), ...typeTokens(t, depth + 1), tok('}'), tok(text, 's'))
        out.push(tok('`', 's'))
        return out
      }
      case 'predicate':
        return [
          tok(type.asserts ? 'asserts ' : ''),
          tok(type.name),
          ...(type.targetType ? [tok(' is ', 'k'), ...typeTokens(type.targetType, depth + 1)] : []),
        ]
      case 'inferred':
        return [tok('infer ', 'k'), tok(type.name)]
      case 'reflection':
        return reflectionTokens(type.declaration, depth)
      default:
        return [tok(type.name ?? 'unknown')]
    }
  }
  function reflectionTokens(decl, depth) {
    if (decl.signatures?.length) {
      const sig = decl.signatures[0]
      return [...paramsTokens(sig, depth), tok(' => '), ...typeTokens(sig.type, depth + 1)]
    }
    const children = decl.children ?? []
    if (!children.length && !decl.indexSignatures?.length) return [tok('{}')]
    if (depth > 1 || children.length > 4) return [tok('{ … }')]
    const out = [tok('{ ')]
    children.forEach((c, i) => {
      if (i) out.push(tok('; '))
      out.push(
        tok(
          `${c.flags?.isReadonly ? 'readonly ' : ''}${c.name}${c.flags?.isOptional ? '?' : ''}: `,
        ),
      )
      out.push(...(c.signatures ? reflectionTokens(c, depth + 1) : typeTokens(c.type, depth + 1)))
    })
    for (const idx of decl.indexSignatures ?? []) {
      if (out.length > 1) out.push(tok('; '))
      const p = idx.parameters?.[0]
      out.push(
        tok(`[${p?.name}: `),
        ...typeTokens(p?.type, depth + 1),
        tok(']: '),
        ...typeTokens(idx.type, depth + 1),
      )
    }
    out.push(tok(' }'))
    return out
  }
  function typeParamsTokens(params) {
    if (!params?.length) return []
    const out = [tok('<')]
    params.forEach((p, i) => {
      if (i) out.push(tok(', '))
      out.push(tok(p.name, 't'))
      if (p.type) out.push(tok(' extends ', 'k'), ...typeTokens(p.type, 1))
      if (p.default) out.push(tok(' = '), ...typeTokens(p.default, 1))
    })
    out.push(tok('>'))
    return out
  }
  function paramsTokens(sig, depth) {
    const out = [...typeParamsTokens(sig.typeParameters), tok('(')]
    ;(sig.parameters ?? []).forEach((p, i) => {
      if (i) out.push(tok(', '))
      out.push(
        tok(
          `${p.flags?.isRest ? '...' : ''}${p.name}${p.flags?.isOptional || p.defaultValue ? '?' : ''}: `,
        ),
      )
      out.push(...typeTokens(p.type, depth + 1))
    })
    out.push(tok(')'))
    return out
  }
  const plain = (tokens) =>
    tokens.map((t) => (Array.isArray(t) ? t[0] : `${t.tokens.map((x) => x[0]).join('')}`)).join('')

  function signatureOf(sig, name, prefix) {
    const tokens = [
      tok(prefix, 'k'),
      tok(name, 'f'),
      ...paramsTokens(sig, 0),
      tok(': '),
      ...typeTokens(sig.type),
    ]
    const returns = sig.comment?.blockTags?.find((t) => t.tag === '@returns')
    return {
      tokens,
      summary: partsToMd(sig.comment?.summary),
      params: (sig.parameters ?? []).map((p) => ({
        name: p.name,
        optional: Boolean(p.flags?.isOptional || p.defaultValue),
        default: p.defaultValue,
        type: typeTokens(p.type),
        summary: partsToMd(p.comment?.summary),
      })),
      returns: { type: typeTokens(sig.type), summary: partsToMd(returns?.content) },
    }
  }

  function membersOf(node) {
    const decl =
      node.kind & K.TypeAlias && node.type?.type === 'reflection' ? node.type.declaration : node
    return (decl.children ?? [])
      .filter((c) => c.kind & MEMBER_KINDS && !c.name.startsWith('~') && !c.flags?.isPrivate)
      .map((c) => {
        const sigs = c.signatures ?? (c.getSignature ? [c.getSignature] : [])
        const isMethod = Boolean(c.kind & (K.Method | K.Constructor))
        const comment = c.comment ?? sigs[0]?.comment
        return {
          name: c.name,
          kind: isMethod ? 'method' : 'property',
          optional: Boolean(c.flags?.isOptional),
          readonly: Boolean(c.flags?.isReadonly || (c.getSignature && !c.setSignature)),
          type: isMethod ? [] : typeTokens(c.type ?? c.getSignature?.type),
          signatures: isMethod ? sigs.map((s) => signatureOf(s, c.name, '')) : [],
          summary: partsToMd(comment?.summary),
          default: c.defaultValue,
        }
      })
  }

  const errors = []
  for (const sym of symbols.values()) {
    const node = sym.__node
    delete sym.__node
    if (CODE_UNIONS.has(sym.name) && node.type?.type === 'union') {
      for (const t of node.type.types) {
        if (t.type === 'literal')
          errors.push({ code: t.value, union: sym.name, specifier: sym.specifier })
      }
    }
    if (node.signatures)
      sym.signatures = node.signatures.map((s) =>
        signatureOf(s, node.name, node.kind & K.Function ? 'function ' : ''),
      )
    else sym.signatures = []
    if (node.kind & K.TypeAlias) {
      const body =
        node.type?.type === 'reflection' && node.type.declaration.children
          ? [tok('{ … }')]
          : typeTokens(node.type)
      sym.declaration = [
        tok('type ', 'k'),
        tok(node.name, 't'),
        ...typeParamsTokens(node.typeParameters),
        tok(' = '),
        ...body,
      ]
    } else if (node.kind & K.Interface) {
      const ext = (node.extendedTypes ?? []).flatMap((t, i) => [
        tok(i ? ', ' : ' extends ', i ? undefined : 'k'),
        ...typeTokens(t),
      ])
      sym.declaration = [
        tok('interface ', 'k'),
        tok(node.name, 't'),
        ...typeParamsTokens(node.typeParameters),
        ...ext,
      ]
    } else if (node.kind & K.Class) {
      sym.declaration = [
        tok('class ', 'k'),
        tok(node.name, 't'),
        ...typeParamsTokens(node.typeParameters),
      ]
    } else if (node.kind & K.Variable) {
      sym.declaration = [
        tok('const ', 'k'),
        tok(node.name, 'f'),
        tok(': '),
        ...typeTokens(node.type),
      ]
    }
    sym.members = node.kind & (K.Interface | K.Class | K.TypeAlias) ? membersOf(node) : []
    sym.signature = plain(sym.signatures[0]?.tokens ?? sym.declaration ?? [])
  }
  return { modules, symbols: [...symbols.values()], undocumented, errors }
}

// Unions whose members are the codes printed in the console.
const CODE_UNIONS = new Set([
  'ErrorCode',
  'EffectErrorCode',
  'TransitionErrorCode',
  'AssetErrorCode',
  'GlslCode',
  'LogCode',
])

export async function main() {
  const started = Date.now()
  const list = entries()
  const json = await convert(list)
  const { modules, symbols, undocumented, errors } = build(json, list)
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'api.json'), JSON.stringify({ modules, symbols }))
  writeFileSync(join(out, 'errors.json'), JSON.stringify(errors))
  const table = []
  for (const s of symbols) {
    table.push({
      id: s.id,
      name: s.name,
      module: s.module,
      kind: s.kind,
      url: s.url,
      signature: s.signature,
      summary: s.summary.split('\n')[0],
    })
    for (const m of s.members)
      table.push({
        id: `${s.id}.${m.name}`,
        name: `${s.name}.${m.name}`,
        module: s.module,
        kind: m.kind,
        url: `${s.url}#${m.name}`,
        member: true,
      })
  }
  writeFileSync(join(out, 'symbols.json'), JSON.stringify(table))
  const ms = Date.now() - started
  console.log(
    `api: ${modules.length} modules, ${symbols.length} symbols, ${undocumented.length} without a description, ${(ms / 1000).toFixed(1)} s`,
  )
  if (undocumented.length && strict) {
    console.error(`Exports without a description:\n  ${undocumented.join('\n  ')}`)
    process.exit(1)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
