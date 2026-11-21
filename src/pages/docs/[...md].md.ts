import type { APIRoute, GetStaticPaths } from 'astro'
import { markdownResponse, type Twin, twins } from '../../docs/lib/twins.ts'

export const getStaticPaths: GetStaticPaths = async () =>
  (await twins())
    .filter((t) => t.url !== '/docs')
    .map((twin) => ({ params: { md: twin.url.slice('/docs/'.length) }, props: { twin } }))

export const GET: APIRoute = ({ props }) =>
  markdownResponse((props as { twin: Twin }).twin.markdown)
