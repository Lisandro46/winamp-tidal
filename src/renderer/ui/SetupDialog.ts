import { centerOnPrimary, keepOnScreen, makeFloating } from './desktop'
import { el } from './rows'

const DASHBOARD_URL = 'https://developer.tidal.com/dashboard'

/**
 * First-run "Configurar TIDAL" window (also the "TIDAL…" button of the Media
 * Library): remote-only use, or catalog mode with the user's own TIDAL app.
 */
export class SetupDialog {
  private placed: boolean
  private body = el('div', { className: 'su-body' })

  constructor(private readonly root: HTMLElement) {
    const titlebar = el(
      'div',
      { className: 'ml-titlebar' },
      el('span', {}, 'CONFIGURAR TIDAL'),
      el(
        'div',
        { className: 'ml-titlebar-actions' },
        el('button', { textContent: '×', title: 'Cerrar (Esc)', onclick: () => this.close() })
      )
    )
    root.append(titlebar, this.body)
    this.placed = makeFloating(root, titlebar, 'setup-position-v1')
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close()
    })
    document.addEventListener('setup:open', () => void this.open())
  }

  async open(): Promise<void> {
    this.root.classList.remove('hidden')
    this.renderChoice((await window.remote.getCredentials()).hasSecret)
    if (!this.placed) centerOnPrimary(this.root)
    this.placed = true
    keepOnScreen(this.root)
  }

  close(): void {
    this.root.classList.add('hidden')
  }

  private renderChoice(catalogOn: boolean): void {
    const option = (title: string, text: string, onclick: () => void, current: boolean): HTMLElement =>
      el(
        'button',
        { className: `su-option ${current ? 'current' : ''}`, onclick },
        el('strong', {}, current ? `${title} (actual)` : title),
        el('span', {}, text)
      )
    this.body.replaceChildren(
      el(
        'p',
        {},
        'Con la app de TIDAL abierta, el Winamp ya maneja play/pausa, temas, volumen, ecualizador y visualizador. ' +
          '¿Querés además buscar y elegir música de TIDAL desde el Winamp?'
      ),
      option(
        'Solo control remoto',
        'Elegís la música en la app de TIDAL y la manejás desde el Winamp. No hay que configurar nada.',
        () => void this.save(null),
        !catalogOn
      ),
      option(
        'Control remoto + buscar en TIDAL',
        'Buscá temas, discos, artistas y playlists públicas y armá la playlist del Winamp. Requiere crear gratis una app en TIDAL (unos 3 minutos).',
        () => this.renderCatalog(),
        catalogOn
      ),
      el('div', { className: 'su-error' })
    )
  }

  private renderCatalog(): void {
    const clientId = el('input', { className: 'ml-search', placeholder: 'Client ID', spellcheck: false })
    const clientSecret = el('input', { className: 'ml-search', type: 'password', placeholder: 'Client Secret' })
    const save = el('button', { textContent: 'Probar y guardar' })
    const submit = (): void => {
      save.disabled = true
      save.textContent = 'Probando…'
      void this.save({ clientId: clientId.value, clientSecret: clientSecret.value }).finally(() => {
        save.disabled = false
        save.textContent = 'Probar y guardar'
      })
    }
    save.onclick = submit
    clientSecret.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit()
    })
    this.body.replaceChildren(
      el(
        'ol',
        { className: 'su-steps' },
        el(
          'li',
          {},
          'Entrá a ',
          el('a', { href: DASHBOARD_URL, target: '_blank', textContent: 'developer.tidal.com/dashboard' }),
          ' e iniciá sesión con tu cuenta de TIDAL.'
        ),
        el('li', {}, 'Creá una app nueva (Create app). El nombre no importa, por ejemplo "Winamp Remote".'),
        el('li', {}, 'Copiá el Client ID y el Client Secret de esa app y pegalos acá:')
      ),
      clientId,
      clientSecret,
      el('div', { className: 'su-note' }, 'Se guardan cifrados en esta PC y solo se usan para hablar con TIDAL.'),
      el('div', { className: 'su-error' }),
      el(
        'div',
        { className: 'su-buttons' },
        el('button', { textContent: '◂ Volver', onclick: () => void this.open() }),
        save
      )
    )
    clientId.focus()
  }

  private async save(credentials: { clientId: string; clientSecret: string } | null): Promise<void> {
    try {
      await window.remote.setCredentials(credentials)
      this.close()
      document.dispatchEvent(new CustomEvent('auth:changed'))
    } catch (error) {
      // Electron prefixes IPC errors with "Error invoking remote method …: Error: ".
      const message = String((error as Error).message).replace(/^.*Error: /, '')
      const target = this.body.querySelector('.su-error')
      if (target) target.textContent = `⚠ ${message}`
    }
  }
}
