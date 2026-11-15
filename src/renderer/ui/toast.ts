/** Short confirmation ("Agregado a …") or error message in the shared #toast element. */
export function toast(message: string, kind: 'ok' | 'error' = 'ok'): void {
  const node = document.querySelector<HTMLElement>('#toast')
  if (!node) return
  node.textContent = message
  node.classList.toggle('ok', kind === 'ok')
  node.classList.add('visible')
  clearTimeout(Number(node.dataset.timer))
  node.dataset.timer = String(setTimeout(() => node.classList.remove('visible'), kind === 'ok' ? 3500 : 6000))
}
