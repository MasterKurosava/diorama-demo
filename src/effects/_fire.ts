// One candle flame for the lantern page: the lantern's glow and the embers on the page breathe
// with it. A pure function of time, so every effect that reads it in the same frame agrees.
import { flicker } from './_lantern'

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Flame brightness around 1 at `t` seconds: a slow breath, layered noise and now and then a
 * gust. Stays within about 0.8 to 1.25 and never changes faster than a few times a second.
 */
export function pulse(t: number): number {
  const breath = 0.045 * Math.sin(t * 1.45) * Math.sin(t * 0.53 + 1.3)
  const drift = 0.1 * (flicker(t * 1.3) - 0.5) + 0.05 * (flicker(t * 2.7 + 17) - 0.5)
  const flutter = 0.025 * (flicker(t * 5.5 + 5) - 0.5)
  // A gust lasts a second or two: the flame leans, dips and flares.
  const gust = smooth(0.68, 0.92, flicker(t * 0.31 + 3))
  const toss = gust * (0.16 * (flicker(t * 3.6 + 9) - 0.5) + 0.06)
  return 1 + breath + drift + flutter + toss
}

/** The flame now, steady with reduced motion. */
export function flame(reduced: boolean): number {
  return reduced ? 1 : pulse(performance.now() / 1000)
}
