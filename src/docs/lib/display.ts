// Code as the docs show it: markup broken one attribute per line once a tag is too long for the
// column, alt text left out, and Twoslash hover types laid out over lines.

/**
 * Columns a code block shows without soft wrapping at the narrowest desktop layout (1280 px wide,
 * sidebar and table of contents open). Hand-written code and generated usage code keep to it.
 */
export const CODE_WIDTH = 60

const ATTR = /\s+([^\s"'=<>/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g
const ATTRS = `(?:${ATTR.source.replace(/\((?!\?)/g, '(?:')})*`
// A comment, a script or style element with its body, or a start tag.
const TAG = new RegExp(
  String.raw`<!--[\s\S]*?-->|<(script|style)\b(${ATTRS})\s*>[\s\S]*?<\/\1\s*>|<([a-zA-Z][\w-]*)(${ATTRS})\s*(\/?)>`,
  'g',
)
const SCRIPT_OPEN = new RegExp(String.raw`^<\w+${ATTRS}\s*>`)

/** One start tag, flat while it fits the column, else one attribute per line. */
function startTag(
  name: string,
  attrs: string,
  close: string,
  column: number,
  indent: string,
  rest: number,
  width: number,
): string {
  const list = [...attrs.matchAll(ATTR)]
    .filter((a) => a[1]?.toLowerCase() !== 'alt')
    .map((a) => (a[2] === undefined ? (a[1] ?? '') : `${a[1]}=${a[2]}`))
  const end = close ? ' />' : '>'
  const flat = `<${name}${list.map((a) => ` ${a}`).join('')}${end}`
  const long =
    column + flat.length > width || (list.length > 1 && column + flat.length + rest > width)
  if (!long || list.length < 2) return flat
  return `<${name}\n${list.map((a) => `${indent}  ${a}`).join('\n')}\n${indent}${end.trim()}`
}

/**
 * Markup as the docs show it: `alt` attributes left out (the live examples keep them), a line of
 * nested tags too long for `width` columns split one element per line, and a start tag that still
 * does not fit broken one attribute per line. Comments, and the bodies of script and style
 * elements, stay as written.
 */
export function displayHtml(html: string, width = CODE_WIDTH): string {
  return attributes(nest(attributes(html, Number.POSITIVE_INFINITY), width), width)
}

const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i
const PIECE = new RegExp(String.raw`<\/?([a-zA-Z][\w-]*)${ATTRS}\s*(\/?)>|[^<]+`, 'g')
const RAW = /<(script|style|pre|textarea)\b|<!--/i

/** Splits a long line of nested elements, `<li><a><img /></a></li>`, one element per line. */
function nest(html: string, width: number): string {
  let raw = false
  return html
    .split('\n')
    .map((line) => {
      if (raw || RAW.test(line)) {
        raw = !/<\/(script|style|pre|textarea)\s*>|-->/i.test(line)
        return line
      }
      if (line.length <= width) return line
      const pieces = [...line.matchAll(PIECE)].map((m) => ({
        text: m[0].trim(),
        name: m[1]?.toLowerCase(),
        closing: m[0].startsWith('</'),
        single: m[2] === '/' || VOID.test(m[1] ?? ''),
      }))
      if (pieces.filter((p) => p.name).length < 2) return line
      const indent = /^\s*/.exec(line)?.[0] ?? ''
      const out: string[] = []
      let depth = 0
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i] as (typeof pieces)[number]
        if (!p.text) continue
        const pad = indent + '  '.repeat(Math.max(0, depth - (p.closing ? 1 : 0)))
        // An element that is empty or holds text only stays whole: `<td>Berlin</td>`.
        const text = pieces[i + 1]
        const end = pieces[i + 2]
        if (p.name && !p.closing && !p.single && text?.closing && text.name === p.name) {
          out.push(pad + p.text + text.text)
          i += 1
          continue
        }
        if (
          p.name &&
          !p.closing &&
          !p.single &&
          text &&
          !text.name &&
          end?.closing &&
          end.name === p.name
        ) {
          out.push(pad + p.text + text.text + end.text)
          i += 2
          continue
        }
        out.push(pad + p.text)
        if (p.closing) depth--
        else if (p.name && !p.single) depth++
      }
      return out.join('\n')
    })
    .join('\n')
}

function attributes(html: string, width: number): string {
  let out = ''
  let at = 0
  for (const m of html.matchAll(TAG)) {
    out += html.slice(at, m.index)
    at = m.index + m[0].length
    const line = out.slice(out.lastIndexOf('\n') + 1)
    const indent = /^[ \t]*/.exec(line)?.[0] ?? ''
    const eol = html.indexOf('\n', at)
    // Text after the tag on its line counts, its own end tag alone does not.
    const after = html.slice(at, eol < 0 ? html.length : eol)
    const rest = m[3] && after.trim() === `</${m[3]}>` ? 0 : after.length
    if (m[1] !== undefined) {
      // Script or style: the start tag is formatted, the body is not.
      const open = SCRIPT_OPEN.exec(m[0])?.[0].length ?? 0
      out += startTag(m[1], m[2] ?? '', '', line.length, indent, 0, width) + m[0].slice(open)
    } else if (m[3] !== undefined) {
      out += startTag(m[3], m[4] ?? '', m[5] ?? '', line.length, indent, rest, width)
    } else out += m[0]
  }
  return out + html.slice(at)
}

// Twoslash hovers. TypeScript prints a signature on one line and repeats an inferred object type
// at every use, so `effect({ amount: 1 }, …)` reads as a wall of `{ readonly amount: 1; }`.

interface Group {
  readonly open: string
  readonly close: string
  readonly items: Token[][]
  /** `;` between the members of an object type, `,` everywhere else. */
  sep: string
}
type Token = string | Group

const OPEN: Record<string, string> = { '(': ')', '{': '}', '[': ']', '<': '>' }

function parse(text: string): Token[] {
  const root: Token[] = []
  const stack: { group: Group; item: Token[] }[] = []
  let item = root
  let buffer = ''
  const flush = () => {
    if (buffer) item.push(buffer)
    buffer = ''
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    if (c === '"' || c === "'" || c === '`') {
      const end = text.indexOf(c, i + 1)
      const stop = end < 0 ? text.length : end + 1
      buffer += text.slice(i, stop)
      i = stop - 1
      continue
    }
    const top = stack[stack.length - 1]
    if (OPEN[c] && !(c === '<' && text[i + 1] === '=')) {
      flush()
      const group: Group = { open: c, close: OPEN[c] as string, items: [[]], sep: ',' }
      item.push(group)
      stack.push({ group, item })
      item = group.items[0] as Token[]
    } else if (top && c === top.group.close && !(c === '>' && text[i - 1] === '=')) {
      flush()
      stack.pop()
      item = top.item
    } else if (top && (c === ',' || c === ';')) {
      flush()
      if (c === ';') top.group.sep = ';'
      item = []
      top.group.items.push(item)
    } else buffer += c
  }
  flush()
  return root
}

const trim = (item: Token[]): Token[] => {
  const out = [...item]
  if (typeof out[0] === 'string') out[0] = out[0].trimStart()
  const last = out.length - 1
  if (typeof out[last] === 'string') out[last] = (out[last] as string).trimEnd()
  return out.filter((t) => t !== '')
}
const members = (g: Group) => g.items.map(trim).filter((i) => i.length)

function flat(tokens: readonly Token[]): string {
  return tokens.map((t) => (typeof t === 'string' ? t : flatGroup(t))).join('')
}
function flatGroup(g: Group): string {
  const items = members(g).map(flat)
  if (!items.length) return g.open + g.close
  if (g.open === '{') return g.sep === ';' ? `{ ${items.join('; ')}; }` : `{ ${items.join(', ')} }`
  return g.open + items.join(', ') + g.close
}

const UNIT = '  '

/** A single plain member such as `<Empty>`: stays on its line even past the column. */
const short = (g: Group): boolean => {
  const only = members(g)
  return (
    only.length === 1 && !!only[0]?.every((x) => typeof x === 'string') && flatGroup(g).length < 32
  )
}

/** Prints tokens from `column` on, breaking the groups that do not fit. */
function print(tokens: readonly Token[], depth: number, column: number, width: number): string {
  const pad = UNIT.repeat(depth)
  // A long union or intersection at this level goes one member per line first.
  const whole = flat(tokens)
  if (column + whole.length > width) {
    const split = splitTop(tokens)
    if (split) {
      const [first, ...rest] = split
      return [
        print(first?.part ?? [], depth, column, width),
        ...rest.map(
          ({ op, part }) => `\n${pad}${UNIT}${op} ${print(part, depth + 1, pad.length + 4, width)}`,
        ),
      ].join('')
    }
  }
  let out = ''
  let col = column
  tokens.forEach((t, i) => {
    if (typeof t === 'string') {
      out += t
      col += t.length
      return
    }
    const text = flatGroup(t)
    // What follows on the same line up to the next group that can break.
    let after = 0
    for (const next of tokens.slice(i + 1)) {
      if (typeof next !== 'string' && !short(next)) break
      after += typeof next === 'string' ? next.length : flatGroup(next).length
    }
    if (col + text.length + after <= width || !members(t).length || short(t)) {
      out += text
      col += text.length
      return
    }
    const items = members(t)
    const inner = pad + UNIT
    if (t.open === '{' && t.sep === ',') {
      // A destructured parameter: names filled into lines.
      const lines: string[] = []
      let line = ''
      for (const [k, item] of items.entries()) {
        const word = flat(item) + (k < items.length - 1 ? ',' : '')
        if (line && inner.length + line.length + 1 + word.length > width) {
          lines.push(line)
          line = word
        } else line = line ? `${line} ${word}` : word
      }
      lines.push(line)
      out += `{\n${lines.map((l) => inner + l).join('\n')}\n${pad}}`
    } else {
      const end = t.sep === ';' ? ';' : ','
      out += `${t.open}\n${items
        .map((item, k) => {
          const mark = t.sep === ';' || k < items.length - 1 ? end : ''
          return inner + print(item, depth + 1, inner.length, width) + mark
        })
        .join('\n')}\n${pad}${t.close}`
    }
    col = pad.length + 1
  })
  return out
}

/** The members of a top-level ` | ` or ` & ` chain, when the tokens are one. */
function splitTop(tokens: readonly Token[]): { op: string; part: Token[] }[] | undefined {
  const parts: { op: string; part: Token[] }[] = [{ op: '', part: [] }]
  let op = ''
  for (const t of tokens) {
    if (typeof t !== 'string') {
      ;(parts[parts.length - 1] as { part: Token[] }).part.push(t)
      continue
    }
    const pieces = t.split(/ ([|&]) /)
    pieces.forEach((piece, k) => {
      if (k % 2) {
        if (op && op !== piece) op = '?'
        else op = piece
        parts.push({ op: piece, part: [] })
      } else if (piece) (parts[parts.length - 1] as { part: Token[] }).part.push(piece)
    })
  }
  // Only a plain chain: `A | B | C`, not a declaration with a chain inside.
  if (parts.length < 2 || op === '?') return undefined
  const head = parts[0]?.part ?? []
  const first = typeof head[0] === 'string' ? head[0] : ''
  const declares = /^(\(\w+\) )?(type [\w$]+ = |(readonly )?[\w$.]+\??: )/.exec(first)
  if (declares) {
    head[0] = first.slice(declares[0].length)
    return [
      { op: '', part: [declares[0].trimEnd()] },
      ...parts.map((p, k) => ({ op: k ? p.op : op, part: p.part })),
    ]
  }
  return parts
}

/** Names TypeScript's own declarations give the type parameters of a few calls. */
const PARAM_NAMES: Record<string, readonly string[]> = { effect: ['P'] }
const FALLBACK = ['T', 'U', 'V', 'W']

/**
 * A hover type laid out to `width` columns: a long signature gets one parameter per line, an
 * object type one member per line, and an inferred object type that a call repeats is printed once
 * as `type P = { … }` and named everywhere else.
 */
export function formatHover(text: string, width = 64): string {
  return statements(text)
    .map((s) => statement(s, width))
    .join('\n')
}

/** Lines of the text outside any bracket start a statement: `import effect` after a signature. */
function statements(text: string): string[] {
  const out = ['']
  let depth = 0
  for (const [i, c] of [...text].entries()) {
    if (c === '\n' && depth === 0) out.push('')
    else out[out.length - 1] += c
    if ('({['.includes(c) || (c === '<' && text[i + 1] !== '=')) depth++
    else if (')}]'.includes(c) || (c === '>' && text[i - 1] !== '=')) depth = Math.max(0, depth - 1)
  }
  return out
}

function statement(text: string, width: number): string {
  const oneLine = text.replace(/\s*\n\s*/g, ' ')
  if (oneLine.length <= width) return text
  // `(property) `, `(method) `: kept in front, the rest is laid out after it.
  const kind = /^\(\w+\) /.exec(oneLine)?.[0] ?? ''
  const source = oneLine.slice(kind.length)
  let body = source
  const named: string[] = []
  const call = /^(?:function |new )?([\w$.]+)</.exec(source)
  const args = call ? parse(source)[1] : undefined
  if (call && args && typeof args !== 'string' && args.open === '<') {
    const names = PARAM_NAMES[call[1]?.split('.').pop() ?? ''] ?? FALLBACK
    members(args).forEach((arg, k) => {
      const type = flat(arg)
      const object = arg.length === 1 && typeof arg[0] !== 'string' ? arg[0] : undefined
      if (object?.open !== '{' || type.length < 24 || source.split(type).length < 3) return
      const name = names[k] ?? FALLBACK[k] ?? `T${k}`
      body = body.split(type).join(name)
      // One member per line even when it would fit: it stands for every repeat.
      const lines = members(object).map((m) => `${UNIT}${print(m, 1, 2, width)};`)
      named.push(`type ${name} = {\n${lines.join('\n')}\n}`)
    })
  }
  const lines = [kind + print(parse(body), 0, kind.length, width), ...named]
  return lines.join('\n\n')
}
