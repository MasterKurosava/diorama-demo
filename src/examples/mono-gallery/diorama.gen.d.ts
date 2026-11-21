// What the build plugin writes for src/effects/mono.ts, so the scripts of the mono examples
// are checked against the effect.
declare module 'dioramajs' {
  interface SiteEffects {
    mono: typeof import('./mono').default
  }
}

export {}
