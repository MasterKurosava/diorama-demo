import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'

const FRAMEWORKS = ['vite', 'astro', 'nuxt', 'next', 'html'] as const

const title = z
  .string()
  .max(60)
  .refine((t) => !t.endsWith('.'), 'no trailing period')
const description = z
  .string()
  .max(160)
  .refine((t) => t.endsWith('.'), 'one sentence ending with a period')

const docs = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/docs' }),
  schema: z.object({
    title,
    description,
    section: z.enum(['home', 'start', 'learn', 'concepts', 'guides', 'effects', 'examples', 'api']),
    order: z.number(),
    // Not `layout`: MDX reads that key as the path of a layout component. Lesson and walkthrough
    // render as articles until the sandbox and walkthrough panels exist.
    template: z.enum(['article', 'lesson', 'walkthrough']).optional(),
    frameworks: z.array(z.enum(FRAMEWORKS)).optional(),
    label: z.string().max(40).optional(),
    /** Pages listed under Related at the end: ids such as 'guides/glsl' or 'api/inputs'. */
    related: z.array(z.string()).optional(),
    draft: z.boolean().optional(),
  }),
})

const errors = defineCollection({
  loader: glob({ pattern: '*.mdx', base: './src/content/errors' }),
  schema: z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$|^[A-Z]+$/),
    level: z.enum(['error', 'warning', 'info']),
    message: z.string(),
    summary: description,
  }),
})

/** A CSS length of extra scroll for a pinned example frame: '150vh', '1200px'. */
export const scrollLength = z.string().regex(/^\d+(?:\.\d+)?(?:vh|svh|lvh|dvh|px|rem)$/)

// Hand-written parts of an effect page: recipes and notes. Title, lede, params
// and the other facts come from the library metadata; the file name is the effect's name.
const effects = defineCollection({
  loader: glob({ pattern: '*.mdx', base: './src/content/effects' }),
  schema: z.object({
    /** Token in markup; must match the file name and an effect in the metadata. */
    effect: z.string().regex(/^[a-z][a-z0-9-]*$/),
    /** The live example from src/examples/effects/<effect>/. */
    example: z
      .object({
        /** One sentence on what the example shows, for screen readers and the no-WebGL note. */
        description: description.optional(),
        /** Box reserved before load, CSS aspect-ratio. Default '3 / 2'. */
        aspect: z.string().optional(),
        caption: z.string().optional(),
        /** Params with sliders: 'live' (default), 'all' or a list. */
        controls: z.union([z.enum(['live', 'all']), z.array(z.string())]).optional(),
        /** Choice params in the variant switcher: all of them by default, or a list. */
        variants: z.array(z.string()).optional(),
        /** Extra scroll the frame stays pinned for, such as '150vh': pin-driven effects. */
        scroll: scrollLength.optional(),
      })
      .optional(),
    /** Guides and other pages under Related: ids such as 'guides/performance'. */
    related: z.array(z.string()).optional(),
    /** A page without its recipes yet. Remove the line when the page is written. */
    stub: z.boolean().optional(),
  }),
})

export const collections = { docs, errors, effects }
