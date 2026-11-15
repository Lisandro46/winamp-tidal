import type { YtAccount, YtAccounts } from '@shared/types'
import '../styles/account.css'
import { el } from './rows'

/** Initials for accounts without a photo. */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

export function accountAvatar(account: YtAccount, className = 'acct-avatar'): HTMLElement {
  if (account.photoUrl) {
    return el('img', { className, src: account.photoUrl, alt: '', referrerPolicy: 'no-referrer' })
  }
  return el('span', { className: `${className} acct-initials` }, initials(account.name))
}

/**
 * "Cambiar de cuenta": lists the YouTube accounts (channels) behind the Google login and
 * switches the one used for the library and playback. Drawn over the Media Library window.
 */
export class AccountChooser {
  private readonly root = el('div', { className: 'acct-overlay hidden' })
  private readonly list = el('div', { className: 'acct-list' })
  private readonly note = el('div', { className: 'acct-note' })

  constructor(library: HTMLElement) {
    const close = (): void => this.root.classList.add('hidden')
    this.root.append(
      el(
        'div',
        { className: 'acct-box' },
        el(
          'div',
          { className: 'ml-titlebar' },
          el('span', {}, 'ELEGIR CUENTA'),
          el('div', { className: 'ml-titlebar-actions' }, el('button', { textContent: '×', title: 'Cerrar', onclick: close }))
        ),
        el('div', { className: 'acct-help' }, 'Tu correo puede tener varias cuentas de YouTube. Elegí la que usás para música.'),
        this.list,
        this.note
      )
    )
    library.append(this.root)
    document.addEventListener('account:choose', () => {
      library.classList.remove('hidden')
      void this.open()
    })
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close()
    })
  }

  private async open(): Promise<void> {
    this.root.classList.remove('hidden')
    this.note.textContent = ''
    this.list.replaceChildren(el('div', { className: 'acct-note' }, 'Buscando tus cuentas…'))
    try {
      this.render(await window.remote.getAccounts())
    } catch {
      this.list.replaceChildren()
      this.note.textContent = 'No se pudieron leer las cuentas. Revisá tu conexión e iniciá sesión de nuevo.'
    }
  }

  private render(info: YtAccounts): void {
    if (!info.accounts.length) {
      this.list.replaceChildren(el('div', { className: 'acct-note' }, 'Iniciá sesión en YouTube Music para elegir una cuenta.'))
      return
    }
    this.list.replaceChildren(
      ...info.accounts.map((account) => {
        const current = account.id === info.current?.id
        const text = el(
          'span',
          { className: 'acct-text' },
          el('span', { className: 'acct-name' }, account.name),
          el('span', { className: 'acct-sub' }, [account.handle, account.email].filter(Boolean).join(' · '))
        )
        return el(
          'button',
          { className: current ? 'acct-row current' : 'acct-row', title: current ? 'Cuenta en uso' : 'Usar esta cuenta', onclick: () => void this.choose(account, current) },
          accountAvatar(account),
          text,
          el('span', { className: 'acct-check' }, current ? '✓' : '')
        )
      })
    )
  }

  private async choose(account: YtAccount, current: boolean): Promise<void> {
    if (current) {
      this.root.classList.add('hidden')
      return
    }
    this.note.textContent = `Cambiando a ${account.name}…`
    this.list.classList.add('busy')
    try {
      await window.remote.selectAccount(account.id)
      this.root.classList.add('hidden')
      // The library, favorites and the status bar reload for the new account.
      document.dispatchEvent(new CustomEvent('auth:changed'))
    } catch {
      this.note.textContent = 'No se pudo cambiar de cuenta (el motivo se muestra arriba).'
    } finally {
      this.list.classList.remove('busy')
    }
  }
}
