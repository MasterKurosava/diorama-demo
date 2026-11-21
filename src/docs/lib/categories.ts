// Effect categories: what the reader wants to animate. An effect
// has one primary `category` and optional extra `tags` in its metadata (`EffectCategory` in
// @dioramajs/effects). The site keeps the titles and the order. Plain TypeScript, so Node scripts
// (scripts/meta.mjs) import it directly.

export interface Category {
  readonly slug: string
  readonly title: string
  /** One line under the category heading in the gallery. */
  readonly blurb: string
}

/** In gallery and sidebar order. */
export const CATEGORIES: readonly Category[] = [
  { slug: 'text', title: 'Text', blurb: 'Headings and paragraphs that enter, split and move.' },
  {
    slug: 'photo',
    title: 'Photo',
    blurb: 'Single images that react to scroll, the pointer and time.',
  },
  {
    slug: 'gallery',
    title: 'Galleries and viewers',
    blurb: 'Sets of pictures, full-screen views, books and 360° photos.',
  },
  { slug: 'video', title: 'Video', blurb: 'Effects around and on top of a playing video.' },
  {
    slug: 'scroll',
    title: 'Scroll scenes',
    blurb: 'Pinned sections and sequences scrubbed by the scroll position.',
  },
  { slug: '3d', title: '3D and product', blurb: 'Models and products the visitor can turn.' },
  { slug: 'background', title: 'Backgrounds', blurb: 'Living backgrounds behind the content.' },
  {
    slug: 'block',
    title: 'Blocks and cards',
    blurb: 'Cards, lists and buttons that answer the pointer.',
  },
  { slug: 'audio', title: 'Sound', blurb: 'Sound of a page player made visible.' },
  { slug: 'data', title: 'Maps and data', blurb: 'Places, routes and numbers drawn in 3D.' },
  {
    slug: 'celebration',
    title: 'Celebration and particles',
    blurb: 'Confetti, sparks and showers for moments worth marking.',
  },
  {
    slug: 'transition',
    title: 'Page transitions',
    blurb: 'Ways one page hands over to the next.',
  },
]

export const CATEGORY_SLUGS: readonly string[] = CATEGORIES.map((c) => c.slug)

export interface Categorized {
  readonly category: string
  readonly tags: readonly string[]
}

export function categorize(effect: {
  readonly category?: string
  readonly tags?: readonly string[]
}): Categorized | undefined {
  const { category } = effect
  if (!category) return undefined
  return { category, tags: (effect.tags ?? []).filter((t) => t !== category) }
}

export const categoryTitle = (slug: string): string =>
  CATEGORIES.find((c) => c.slug === slug)?.title ?? slug

/** Problems with the category fields of one effect, for scripts/meta.mjs. */
export function checkCategory(effect: {
  readonly category?: unknown
  readonly tags?: unknown
}): string[] {
  const problems: string[] = []
  if (effect.category === undefined || effect.category === '') problems.push('category is missing')
  else if (!CATEGORY_SLUGS.includes(String(effect.category)))
    problems.push(
      `category "${String(effect.category)}" is not one of ${CATEGORY_SLUGS.join(', ')}`,
    )
  if (effect.tags === undefined) return problems
  if (!Array.isArray(effect.tags)) return [...problems, 'tags is not a list']
  for (const t of effect.tags)
    if (!CATEGORY_SLUGS.includes(String(t))) problems.push(`tag "${String(t)}" is not a category`)
  if (effect.tags.includes(effect.category)) problems.push('tags repeat the category')
  return problems
}
