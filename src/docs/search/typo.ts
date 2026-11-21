/** Optimal string alignment distance (Damerau–Levenshtein with adjacent transpositions). */
export function distance(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const rows: number[][] = []
  for (let i = 0; i <= a.length; i++) rows.push([i])
  const first = rows[0] as number[]
  for (let j = 1; j <= b.length; j++) first[j] = j
  for (let i = 1; i <= a.length; i++) {
    const row = rows[i] as number[]
    const prev = rows[i - 1] as number[]
    let best = Number.POSITIVE_INFINITY
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let d = Math.min(
        (prev[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, (rows[i - 2]?.[j - 2] as number) + 1)
      }
      row[j] = d
      best = Math.min(best, d)
    }
    if (best > max) return max + 1
  }
  return rows[a.length]?.[b.length] as number
}

/** Allowed distance: 1 for words up to 5 letters, 2 for longer ones. */
export const allowed = (word: string): number => (word.length <= 5 ? 1 : 2)

/** The closest dictionary word, or undefined when the word is known or nothing is close. */
export function correct(word: string, words: readonly string[]): string | undefined {
  const w = word.toLowerCase()
  if (w.length < 3) return undefined
  const lower = words.map((x) => x.toLowerCase())
  if (lower.includes(w)) return undefined
  const max = allowed(w)
  let found: string | undefined
  let best = max + 1
  lower.forEach((candidate, i) => {
    const d = distance(w, candidate, max)
    if (d < best) {
      best = d
      found = words[i]
    }
  })
  return found
}

/** Corrects every word of a query; undefined when nothing changed. */
export function correctQuery(query: string, words: readonly string[]): string | undefined {
  let changed = false
  const out = query
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const fix = correct(word, words)
      if (fix) changed = true
      return fix ?? word
    })
  return changed ? out.join(' ') : undefined
}
