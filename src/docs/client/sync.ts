// Site-wide choices: framework and package manager. Stored, mirrored on <html> for CSS, announced
// to every synced tab list and the sidebar select.
export type SyncGroup = 'framework' | 'pm'

const ATTR: Record<SyncGroup, string> = { framework: 'data-framework', pm: 'data-pm' }
const KEY: Record<SyncGroup, string> = { framework: 'dio.framework', pm: 'dio.pm' }
const DEFAULT: Record<SyncGroup, string> = { framework: 'vite', pm: 'npm' }

export const EVENT = 'dio:synced'

export function current(group: SyncGroup): string {
  return document.documentElement.getAttribute(ATTR[group]) ?? DEFAULT[group]
}

export function choose(group: SyncGroup, value: string): void {
  document.documentElement.setAttribute(ATTR[group], value)
  try {
    localStorage.setItem(KEY[group], value)
  } catch {
    // Without storage the choice lasts for this page.
  }
  document.dispatchEvent(new CustomEvent(EVENT, { detail: { group, value } }))
}
