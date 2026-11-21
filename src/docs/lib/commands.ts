export type Framework = 'vite' | 'astro' | 'nuxt' | 'next' | 'html'
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export const FRAMEWORKS: readonly { readonly value: Framework; readonly label: string }[] = [
  { value: 'vite', label: 'Vite' },
  { value: 'astro', label: 'Astro' },
  { value: 'nuxt', label: 'Nuxt' },
  { value: 'next', label: 'Next.js' },
  { value: 'html', label: 'HTML' },
]

export const MANAGERS: readonly { readonly value: PackageManager; readonly label: string }[] = [
  { value: 'npm', label: 'npm' },
  { value: 'pnpm', label: 'pnpm' },
  { value: 'yarn', label: 'yarn' },
  { value: 'bun', label: 'bun' },
]

export function installCommand(pm: PackageManager, packages: string, dev = false): string {
  const list = packages.trim().split(/\s+/).join(' ')
  if (pm === 'npm') return `npm install${dev ? ' -D' : ''} ${list}`
  if (pm === 'bun') return `bun add${dev ? ' -d' : ''} ${list}`
  return `${pm} add${dev ? ' -D' : ''} ${list}`
}

export function runCommand(pm: PackageManager, command: string): string {
  const prefix = { npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx' }[pm]
  return `${prefix} ${command.trim()}`
}

const KEYS: Record<string, string> = {
  shift: 'Shift',
  alt: 'Alt',
  ctrl: 'Ctrl',
  enter: 'Enter',
  esc: 'Esc',
  escape: 'Esc',
  tab: 'Tab',
  space: 'Space',
  delete: 'Delete',
  backspace: 'Backspace',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
}

/** One key as printed: 'shift' is Shift, 'p' is P; 'mod' is Ctrl outside Apple platforms. */
export const keyLabel = (key: string): string =>
  key.toLowerCase() === 'mod'
    ? 'Ctrl'
    : (KEYS[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key))
