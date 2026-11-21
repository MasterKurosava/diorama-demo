// A live board: each status changes every few seconds, the way a timetable feed would set it.
const statuses = [
  'ON TIME',
  'BOARDING',
  'DELAYED',
  'GATE OPEN',
  'LAST CALL',
  'DEPARTED',
]

export default function mount(example: HTMLElement): () => void {
  const rows = [...example.querySelectorAll<HTMLElement>('.sf-status')]
  let turn = 0
  const timer = window.setInterval(() => {
    const row = rows[turn % rows.length]
    turn++
    if (!row) return
    const now = statuses.indexOf(row.textContent ?? '')
    row.textContent =
      statuses[(now + 1 + (turn % 2)) % statuses.length] ?? 'ON TIME'
  }, 2500)
  return () => window.clearInterval(timer)
}
