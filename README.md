# Diorama demo

A paper diorama from dusk to dawn: one page per capability of [Diorama](https://github.com/MasterKurosava/diorama), three.js effects on ordinary HTML.

## Run

Requires Node.js 22.12+ or 24+ and pnpm. The library is linked from `../diorama` (the release repository, built with `pnpm build`) until it is published to npm.

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # static site in dist/
pnpm preview
```

`dist/` is a static site with three pages (`/`, `/work/ridges/`, `/work/lantern/`) and can be served by any static host.

## License

MIT
