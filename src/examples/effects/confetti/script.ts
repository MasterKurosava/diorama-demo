// The order button shows what the shop does after a click: the burst plays over it and the click
// itself is never cancelled. Fire clicks it from the panel.
export default function mount(example: HTMLElement): () => void {
  const pay = example.querySelector<HTMLButtonElement>('.cf-pay')
  const status = example.querySelector('.cf-status')
  const fire = example.querySelector<HTMLButtonElement>('[data-replay]')
  if (!pay) return () => {}
  let timer = 0
  const onPay = () => {
    pay.textContent = 'Order placed'
    if (status)
      status.textContent = 'Thank you. Your receipt is on its way.'
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      pay.textContent = 'Place order'
      if (status) status.textContent = ''
    }, 3000)
  }
  const onFire = () => pay.click()
  pay.addEventListener('click', onPay)
  fire?.addEventListener('click', onFire)
  return () => {
    clearTimeout(timer)
    pay.removeEventListener('click', onPay)
    fire?.removeEventListener('click', onFire)
  }
}
