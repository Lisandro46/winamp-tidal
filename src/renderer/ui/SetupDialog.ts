import type { ProviderId } from '@shared/types'
import { centerOnPrimary, keepOnScreen, makeFloating } from './desktop'
import { el } from './rows'

const DASHBOARD_URL = 'https://developer.tidal.com/dashboard'

/**
 * First-run setup (also the service button of the Media Library): pick TIDAL or
 * YouTube Music; for TIDAL, remote-only use or catalog mode with the user's own
 * TIDAL app; for YouTube Music, an optional Google sign-in.
 */
export class SetupDialog {
  private placed: boolean
  private body = el('div', { className: 'su-body' })
  private heading = el('span', {}, 'ELEGIR SERVICIO')

  constructor(private readonly root: HTMLElement) {
    const titlebar = el(
      'div',
      { className: 'ml-titlebar' },
      this.heading,
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
    this.renderService((await window.remote.getAuth()).provider)
    if (!this.placed) centerOnPrimary(this.root)
    this.placed = true
    keepOnScreen(this.root)
  }

  close(): void {
    this.root.classList.add('hidden')
  }

  private option(title: string, text: string, onclick: () => void, current: boolean): HTMLElement {
    return el(
      'button',
      { className: `su-option ${current ? 'current' : ''}`, onclick },
      el('strong', {}, current ? `${title} (actual)` : title),
      el('span', {}, text)
    )
  }

  private renderService(current: ProviderId): void {
    this.heading.textContent = 'ELEGIR SERVICIO'
    this.body.replaceChildren(
      el('p', {}, '¿Con qué servicio vas a escuchar música en el Winamp?'),
      this.option(
        'TIDAL',
        'El Winamp maneja la app de escritorio de TIDAL (tiene que estar abierta). Opcional: buscar en TIDAL con tu propia app de desarrollador.',
        () => void this.choose('tidal'),
        current === 'tidal'
      ),
      this.option(
        'YouTube Music',
        'Suena desde el mismo Winamp, sin otra app. Buscá y reproducí cualquier tema; iniciando sesión con Google ves tus favoritos y playlists.',
        () => void this.choose('ytmusic'),
        current === 'ytmusic'
      ),
      el('div', { className: 'su-error' })
    )
  }

  private async choose(provider: ProviderId): Promise<void> {
    try {
      const auth = await window.remote.setProvider(provider)
      if (provider === 'tidal') this.renderChoice((await window.remote.getCredentials()).hasSecret)
      else this.renderYouTube(auth.connected)
    } catch (error) {
      this.showError(error)
    }
  }

  private renderYouTube(connected: boolean): void {
    this.heading.textContent = 'YOUTUBE MUSIC'
    const login = el('button', { textContent: 'Iniciar sesión con Google' })
    login.onclick = () => {
      login.disabled = true
      login.textContent = 'Esperando el inicio de sesión…'
      window.remote
        .connect()
        .then(() => {
          document.dispatchEvent(new CustomEvent('auth:changed'))
          this.close()
        })
        .catch((error) => this.showError(error))
        .finally(() => {
          login.disabled = false
          login.textContent = 'Iniciar sesión con Google'
        })
    }
    this.body.replaceChildren(
      el(
        'p',
        {},
        connected
          ? 'Listo: YouTube Music está conectado con tu cuenta. Buscá música con "+ Agregar desde YouTube Music" o la tecla J.'
          : 'Listo: ya podés buscar y reproducir con "+ Agregar desde YouTube Music" o la tecla J. Si iniciás sesión con tu cuenta de Google vas a ver tus favoritos, playlists y mixes (y con YouTube Premium, sin anuncios).'
      ),
      el('div', { className: 'su-note' }, 'El inicio de sesión se hace en una ventana de Google y queda guardado en esta PC.'),
      el('div', { className: 'su-error' }),
      el(
        'div',
        { className: 'su-buttons' },
        el('button', { textContent: '◂ Volver', onclick: () => void this.open() }),
        ...(connected
          ? []
          : [
              login,
              el('button', {
                textContent: 'Usar la sesión de mi navegador…',
                title: 'Si Google te pide una llave de acceso (passkey) o no te deja entrar acá',
                onclick: () => this.renderCookieImport()
              })
            ]),
        el('button', { textContent: connected ? 'Cerrar' : 'Más tarde', onclick: () => this.close() })
      )
    )
  }

  /** For accounts Google won't sign in here (passkey-only): reuse the browser's session. */
  private renderCookieImport(): void {
    this.heading.textContent = 'YOUTUBE MUSIC · SESIÓN DEL NAVEGADOR'
    const input = el('textarea', {
      className: 'ml-search su-cookies',
      placeholder: 'Pegá acá el valor de "cookie" (o el archivo cookies.txt)',
      spellcheck: false
    })
    const save = el('button', { textContent: 'Conectar' })
    save.onclick = () => {
      save.disabled = true
      save.textContent = 'Conectando…'
      window.remote
        .importYouTubeSession(input.value)
        .then(() => {
          document.dispatchEvent(new CustomEvent('auth:changed'))
          this.close()
        })
        .catch((error) => this.showError(error))
        .finally(() => {
          save.disabled = false
          save.textContent = 'Conectar'
        })
    }
    this.body.replaceChildren(
      el(
        'ol',
        { className: 'su-steps' },
        el(
          'li',
          {},
          'En Chrome o Edge, abrí ',
          el('a', { href: 'https://music.youtube.com', target: '_blank', textContent: 'music.youtube.com' }),
          ' con tu cuenta iniciada.'
        ),
        el('li', {}, 'Apretá F12, andá a la pestaña "Red" (Network) y recargá la página con F5.'),
        el('li', {}, 'Escribí "browse" en el filtro y hacé clic en el primer resultado.'),
        el(
          'li',
          {},
          'En "Encabezados de solicitud" (Request Headers) buscá "cookie", clic derecho → Copiar valor, y pegalo acá:'
        )
      ),
      input,
      el(
        'div',
        { className: 'su-note' },
        'Es tu sesión de YouTube: se guarda solo en esta PC y no se comparte con nadie. Si cerrás sesión en el navegador, acá también se corta.'
      ),
      el('div', { className: 'su-error' }),
      el(
        'div',
        { className: 'su-buttons' },
        el('button', { textContent: '◂ Volver', onclick: () => this.renderYouTube(false) }),
        save
      )
    )
    input.focus()
  }

  private showError(error: unknown): void {
    // Electron prefixes IPC errors with "Error invoking remote method …: Error: ".
    const message = String((error as Error).message).replace(/^.*Error: /, '')
    const target = this.body.querySelector('.su-error')
    if (target) target.textContent = `⚠ ${message}`
  }

  private renderChoice(catalogOn: boolean): void {
    this.heading.textContent = 'CONFIGURAR TIDAL'
    const option = this.option.bind(this)
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
      el('div', { className: 'su-error' }),
      el('div', { className: 'su-buttons' }, el('button', { textContent: '◂ Volver', onclick: () => void this.open() }))
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
        el('button', {
          textContent: '◂ Volver',
          onclick: () => void window.remote.getCredentials().then((c) => this.renderChoice(c.hasSecret))
        }),
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
      this.showError(error)
    }
  }
}
