import type { APIRoute } from 'astro'
import { twins } from '../docs/lib/twins.ts'
import { DESCRIPTION, NAME, SITE } from '../docs/site.ts'

const ORDER = ['Docs', 'Getting started', 'Learn', 'Concepts', 'Guides', 'Effects', 'API', 'Errors']

export const GET: APIRoute = async () => {
  const all = (await twins()).filter((t) => t.group !== 'API symbols')
  const sections = ORDER.flatMap((group) => {
    const list = all.filter((t) => t.group === group)
    if (!list.length) return []
    const title = group === 'Docs' ? 'Start here' : group
    return [
      `## ${title}\n\n${list.map((t) => `- [${t.title}](${SITE}${t.url}.md): ${t.description}`).join('\n')}`,
    ]
  })
  const text = `# ${NAME}\n\n> ${DESCRIPTION}\n\nThe whole guide text is in [llms-full.txt](${SITE}/llms-full.txt) and the API reference in [llms-api.txt](${SITE}/llms-api.txt).\n\n${sections.join('\n\n')}\n`
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
