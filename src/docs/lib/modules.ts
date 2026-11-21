// One line per module of the reference. The packages have no module comments yet, so the lines
// follow the package table of the library README.
export const MODULE_SUMMARY: Readonly<Record<string, string>> = {
  diorama: 'The site entry: start(), effect() and the re-exports most sites need.',
  'diorama-vite': 'Vite plugin that turns the effects folder into a lazy registry with types.',
  'diorama-astro': 'Astro integration that adds the Vite plugin.',
  'diorama-nuxt': 'Nuxt module that adds the Vite plugin with the effects folder under srcDir.',
  'diorama-next': 'Next.js wrapper that writes the effect registry for webpack and Turbopack.',
  'diorama-auto': 'The no-build entry served from a CDN; it starts on its own.',
  'diorama-kit': 'Helpers for your own effects, and the built-in image layer for their children.',
  'diorama-audio-graph':
    'One audio graph per page, shared by the audio effects and copies of them.',
  'diorama-model-rig':
    'The placed scene that model publishes to explode, hotspots and their copies.',
  core: 'App, plugins, signals, frame loop, stage, scroll and pointer.',
  effects: 'Effects on DOM elements and their runtime.',
  'effects-effect': 'effect() and defineEffect() without the rest of the effects package.',
  'effects-kit': 'Helpers for effect modules and site effects, loaded in lazy chunks only.',
  'audio-graph': 'One audio graph per page: one AudioContext and one source per media element.',
  'model-rig': 'How model shares its placed scene with the effects that work on it.',
  'effects-testing': 'Test helpers for effects: a GPU stand-in and probe().',
  render: 'WebGPU renderer with the WebGL 2 fallback.',
  media: 'Image effects: image, ripple, bend.',
  transitions: 'Page transitions and flights of keyed elements.',
  assets: 'Asset loading, cache and preload.',
  'assets-three': 'Loaders for glTF with Draco, Meshopt and KTX2.',
  gsap: 'GSAP and ScrollTrigger on the Diorama frame.',
  lenis: 'Lenis smooth scroll on the Diorama frame.',
  glsl: 'Converted GLSL stages as effects, without the transpiler.',
  'glsl-vite': 'Vite plugin that turns .frag files into effects.',
  'glsl-loader': 'webpack 5 and Turbopack loader for .frag files.',
  'glsl-convert': 'GLSL to TSL at build time, in Node.',
  'glsl-entries': 'A folder of shader entries as an effect registry.',
}

export function moduleSummary(slug: string, specifier: string): string {
  return MODULE_SUMMARY[slug] ?? `Exports of ${specifier}.`
}
