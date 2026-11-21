import { app } from '../../docs/diorama.ts'

// The counter of src/main.ts, plus the frames of the last second.
export default (example: HTMLElement) => {
  const meter = example.querySelector('.frames')
  const rate = example.querySelector('.rate')
  let last = app.loop.stats.frames
  let ticks = 0
  const timer = setInterval(() => {
    const frames = app.loop.stats.frames
    if (meter) meter.textContent = String(frames)
    if (++ticks % 4 === 0) {
      if (rate) rate.textContent = String(frames - last)
      last = frames
    }
  }, 250)
  return () => clearInterval(timer)
}
