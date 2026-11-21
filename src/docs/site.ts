// Site constants. Plain TypeScript without enums or parameter properties, so Node scripts can
// import this file directly.

/** Production origin. The domain is not chosen yet. */
export const SITE = 'https://dioramajs.dev'

/** Public library repository: source links and the GitHub link in the header. */
export const REPO = 'https://github.com/MasterKurosava/diorama'

/** Branch or tag the source links point at. */
export const REPO_REF = 'main'

export const NAME = 'Diorama'

/** The package sites install and import. The rename to dioramajs changes it here. */
export const PACKAGE = 'dioramajs'

export const DESCRIPTION =
  'Diorama puts three.js effects on ordinary HTML elements with a data-dio attribute. The canvas follows layout and scroll, draws only when something changes and flies keyed elements between pages.'
