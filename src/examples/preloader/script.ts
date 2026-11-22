import { ready } from '@dioramajs/diorama'
import { app } from '../../docs/diorama.ts'

const IMAGES = [
  '/media/prints/dawn.jpg',
  '/media/prints/dusk.jpg',
  '/media/prints/night.jpg',
]
// Stands in for a slow network: every body is read at 48 KB a second, all of them in turn.
const RATE = 48_000
let line = Promise.resolve()

async function slowBlob(url: string): Promise<Blob> {
  const response = await fetch(url)
  const reader = response.body?.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  for (
    let read = await reader?.read();
    read && !read.done;
    read = await reader?.read()
  ) {
    const chunk = read.value
    line = line.then(
      () =>
        new Promise((done) =>
          setTimeout(done, (chunk.length / RATE) * 1000),
        ),
    )
    await line
    chunks.push(chunk)
  }
  return new Blob(chunks, {
    type: response.headers.get('content-type') ?? 'image/jpeg',
  })
}

async function addImage(shots: Element, url: string): Promise<void> {
  const img = document.createElement('img')
  img.alt = ''
  img.src = URL.createObjectURL(await slowBlob(url))
  shots.append(img)
  await img.decode()
}

// src/main.ts of the guide, run on the box of the example instead of the whole page.
export default (example: HTMLElement) => {
  const preloader = example.querySelector<HTMLElement>('#preloader')
  const bar = example.querySelector<HTMLElement>('#bar')
  const shots = example.querySelector('.shots')
  const again = example.querySelector('.again')
  if (!preloader || !bar || !shots) return

  async function boot(): Promise<void> {
    try {
      await ready(app)
      // The weight is in bytes, about the size of each print.
      for (const url of IMAGES)
        app.assets.track(addImage(shots as Element, url), {
          weight: 45_000,
        })
      const off = app.assets.progress.subscribe((p) => {
        if (bar) bar.style.transform = `scaleX(${p})`
      })
      // The engine and the three prints. Never rejects.
      await app.assets.ready()
      off()
    } finally {
      if (preloader) preloader.style.opacity = '0'
    }
  }

  const replay = () => {
    for (const img of shots.querySelectorAll('img')) {
      URL.revokeObjectURL(img.src)
      img.remove()
    }
    preloader.style.transition = 'none'
    preloader.style.opacity = '1'
    bar.style.transform = 'scaleX(0)'
    void preloader.offsetWidth
    preloader.style.transition = ''
    void boot()
  }
  again?.addEventListener('click', replay)
  void boot()
  return () => again?.removeEventListener('click', replay)
}
