import { FEATURED_SKINS, type MuseumSkin } from '@shared/skins'
import { centerOnPrimary, keepOnScreen, makeFloating } from './desktop'
import { el } from './rows'

export interface SkinActions {
  /** Applies and remembers a skin url (`skin://…` or a data url). */
  apply(url: string): void
  /** Opens the file picker for a local .wsz. */
  pick(): void
  reset(): void
}

const MUSEUM_URL = 'https://skins.webamp.org/'
const SEARCH_DEBOUNCE_MS = 400

/** Skin browser: featured skins plus a search of the Winamp Skin Museum (~70.000 classic skins). */
export class SkinDialog {
  private placed: boolean
  private loadToken = 0
  private searchTimer: ReturnType<typeof setTimeout> | undefined
  private current: string | undefined

  private input = el('input', {
    type: 'search',
    className: 'ml-search',
    placeholder: 'Buscar en el Skin Museum (ej: pioneer, matrix, kenwood)…'
  })
  private crumb = el('div', { className: 'ml-list-title' })
  private grid = el('div', { className: 'ml-content sk-grid', tabIndex: 0 })

  constructor(
    private readonly root: HTMLElement,
    private readonly skins: SkinActions,
    current: string | undefined
  ) {
    this.current = current
    const titlebar = el(
      'div',
      { className: 'ml-titlebar' },
      el('span', {}, 'SKINS'),
      el(
        'div',
        { className: 'ml-titlebar-actions' },
        el('button', { textContent: '×', title: 'Cerrar (Esc)', onclick: () => this.close() })
      )
    )
    root.append(
      titlebar,
      el('div', { className: 'sd-top' }, this.input),
      el(
        'div',
        { className: 'ml-list-header sd-header' },
        this.crumb,
        el(
          'div',
          { className: 'ml-list-actions' },
          el('button', { textContent: 'Destacados', onclick: () => this.showFeatured() }),
          el('button', { textContent: 'Desde archivo…', title: 'Cargar un .wsz de tu PC', onclick: () => skins.pick() }),
          el('button', { textContent: 'Skin base', title: 'Volver al skin clásico', onclick: () => skins.reset() })
        )
      ),
      this.grid,
      el(
        'div',
        { className: 'sd-hint' },
        'Clic para aplicar · se descargan una vez y quedan guardados · ',
        el('a', { href: MUSEUM_URL, target: '_blank', textContent: 'skins.webamp.org' })
      )
    )
    this.placed = makeFloating(root, titlebar, 'skins-position-v1')
    this.input.addEventListener('input', () => {
      clearTimeout(this.searchTimer)
      this.searchTimer = setTimeout(() => this.search(), SEARCH_DEBOUNCE_MS)
    })
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.search()
    })
    // Keep Webamp's hotkeys from firing while typing here.
    root.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Escape') this.close()
    })
    document.addEventListener('skins:open', () => this.open())
  }

  open(): void {
    this.root.classList.remove('hidden')
    if (!this.placed) centerOnPrimary(this.root)
    this.placed = true
    keepOnScreen(this.root)
    this.input.focus()
    if (!this.grid.childElementCount) this.showFeatured()
  }

  close(): void {
    this.root.classList.add('hidden')
  }

  private showFeatured(): void {
    this.loadToken++
    this.input.value = ''
    this.crumb.textContent = 'Destacados'
    this.render(FEATURED_SKINS)
  }

  private async search(): Promise<void> {
    clearTimeout(this.searchTimer)
    const query = this.input.value.trim()
    if (!query) return this.showFeatured()
    const token = ++this.loadToken
    this.crumb.textContent = `Buscando “${query}”…`
    try {
      const skins = await window.remote.searchSkins(query)
      if (token !== this.loadToken) return
      this.crumb.textContent = `“${query}” · ${skins.length} skins`
      this.render(skins)
    } catch {
      if (token === this.loadToken) this.crumb.textContent = 'No se pudo conectar con el Skin Museum'
    }
  }

  private render(skins: MuseumSkin[]): void {
    if (!skins.length) {
      this.grid.replaceChildren(el('div', { className: 'ml-empty' }, 'Sin resultados'))
      return
    }
    this.grid.replaceChildren(
      ...skins.map((skin) => {
        const card = el(
          'button',
          {
            className: `sk-card ${skin.url === this.current ? 'active' : ''}`,
            title: skin.name,
            onclick: () => {
              this.current = skin.url
              this.grid.querySelectorAll('.sk-card.active').forEach((c) => c.classList.remove('active'))
              card.classList.add('active')
              this.skins.apply(skin.url)
            }
          },
          el('img', { src: skin.screenshotUrl, alt: '', loading: 'lazy' }),
          el('span', { textContent: skin.name })
        )
        return card
      })
    )
  }
}
