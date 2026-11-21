// A year of rows, one per day: a real page renders them on the server from its own records.
export default function mount(example: HTMLElement): void {
  const body = example.querySelector('tbody')
  if (!body) return
  let seed = 11
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const rows: string[] = []
  for (let d = 0; d < 365; d++) {
    const date = new Date(Date.UTC(2026, 0, 1 + d))
    const iso = date.toISOString().slice(0, 10)
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6
    const summer = Math.sin((d / 365) * Math.PI) ** 2
    const shifts =
      random() < 0.12
        ? 0
        : Math.round((weekend ? 6 : 2) * summer + random() * 3)
    rows.push(
      `<tr><td><time datetime="${iso}">${iso}</time></td><td>${shifts}</td></tr>`,
    )
  }
  body.innerHTML = rows.join('')
}
