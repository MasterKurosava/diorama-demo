import type { APIRoute } from 'astro'
import { twins } from '../docs/lib/twins.ts'

export const GET: APIRoute = async () => {
  const pages = (await twins()).filter((t) => !t.group.startsWith('API') && t.group !== 'Errors')
  return new Response(pages.map((t) => t.markdown).join('\n\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
