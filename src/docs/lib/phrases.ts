// Sentences the effect page builds from metadata values, one per value. They follow
// the same voice rules as any page text.

/** Frame policy of `frames.policy`. */
export const FRAMES: Readonly<Record<string, string>> = {
  input: 'Draws only when you scroll, move the pointer over it or change a param.',
  hover: 'Draws while the pointer is over it and while hover fades, then stops.',
  visible: 'Draws every frame while it is on screen.',
  function: 'Draws only while something on it moves, then stops.',
  update: 'Draws only while something on it moves, then stops.',
  fps: 'Draws at a steady rate while it is on screen and stops when it leaves.',
}

/** `reducedMotion.mode`. */
export const MOTION: Readonly<Record<string, string>> = {
  static:
    'With reduced motion it shows a still frame: motion inputs are zero and time stands still.',
  off: 'With reduced motion it is off and the element shows as plain HTML.',
}

/** `when` set to a query about hover: touch devices skip the effect. */
export const TOUCH_SKIPPED = 'Skipped on touch devices, which never load the engine for it.'
export const EVERY_DEVICE = 'Runs on every device.'

/** `when` set to some other media query. */
export const onlyWhere = (query: string): string =>
  `Runs only where \`${query}\` matches; elsewhere the engine never loads for it.`
