// Effect pages: the library metadata joined with src/content/effects/<name>.mdx.
import { type CollectionEntry, getCollection } from 'astro:content'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type EffectInfo, type EffectMeta, effectList } from './effects.ts'
import { isStrict } from './strict.ts'
import { load } from './tables.ts'

export interface EffectPage {
  readonly info: EffectInfo
  readonly entry: CollectionEntry<'effects'>
  /** Folder id of the live example, 'effects/reveal', when src/examples/effects/<name> exists. */
  readonly example?: string
  /** Gallery card markup: card.html of the example folder; without one the card shows its poster. */
  readonly card?: string
  /** '/previews/reveal' without extension; .avif and .webp exist. */
  readonly poster?: string
  /** '/previews/reveal.webm': a short muted loop recorded by scripts/previews.mjs. */
  readonly clip?: string
}

const root = process.cwd()

export function effectMetas(): EffectMeta[] {
  return load().effects.effects as unknown as EffectMeta[]
}

/** Every effect with its page, in category order. Cheap: Astro caches the collection. */
export async function effectPages(): Promise<EffectPage[]> {
  const list = effectList(effectMetas())
  const entries = await getCollection('effects')
  const problems: string[] = []
  for (const entry of entries) {
    if (entry.id !== entry.data.effect)
      problems.push(`src/content/effects/${entry.id}.mdx names effect "${entry.data.effect}"`)
    if (!list.some((e) => e.name === entry.data.effect))
      problems.push(
        `src/content/effects/${entry.id}.mdx: no effect "${entry.data.effect}" in the metadata`,
      )
  }
  for (const e of list)
    if (!entries.some((x) => x.data.effect === e.name))
      problems.push(`effect "${e.name}" has no page: add src/content/effects/${e.name}.mdx`)
  if (problems.length) {
    const text = `Effect pages:\n  ${problems.join('\n  ')}`
    if (isStrict()) throw new Error(text)
    console.error(`[docs] ${text}`)
  }
  return list.flatMap((info) => {
    const entry = entries.find((x) => x.data.effect === info.name)
    if (!entry) return []
    const dir = join(root, 'src/examples/effects', info.name)
    const example = existsSync(join(dir, 'index.html')) ? `effects/${info.name}` : undefined
    // Only markup made for the card runs live in it: a page example is sized for the page (full
    // width, pinned scroll, players) and falls apart in a card, where the poster shows it instead.
    const card = existsSync(join(dir, 'card.html')) ? 'card.html' : undefined
    const poster = existsSync(join(root, 'public/previews', `${info.name}.avif`))
      ? `/previews/${info.name}`
      : undefined
    const clip =
      poster && existsSync(join(root, 'public/previews', `${info.name}.webm`))
        ? `/previews/${info.name}.webm`
        : undefined
    return [
      {
        info,
        entry,
        example,
        card: card && example ? `${example}/${card}` : undefined,
        poster,
        clip,
      },
    ]
  })
}
