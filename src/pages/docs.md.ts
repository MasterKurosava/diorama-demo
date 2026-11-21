import type { APIRoute } from 'astro'
import { markdownResponse, twins } from '../docs/lib/twins.ts'

export const GET: APIRoute = async () => {
  const home = (await twins()).find((t) => t.url === '/docs')
  if (!home) throw new Error('the docs home has no twin')
  return markdownResponse(home.markdown)
}
