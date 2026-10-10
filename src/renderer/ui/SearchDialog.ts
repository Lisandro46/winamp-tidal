import type { Collection, SearchResults, Track } from '@shared/types'
import type { RemoteController } from '../webamp/controller'
import { centerOnPrimary, keepOnScreen, makeFloating } from './desktop'
import { favorites, library, SECTIONS, type Section } from './library'
import { collectionRow, el, refreshHearts, trackRow } from './rows'

type Filter = 'all' | 'tracks' | 'albums' | 'artists' | 'playlists'

type View =
  | { kind: 'home' }
  | { kind: 'search'; query: string }
  | { kind: 'liked' }
  | { kind: 'section'; section: Section }
  | { kind: 'collection'; collection: Collection }

const FILTERS: { filter: Filter; label: string }[] = [
  { filter: 'all', label: 'Todo' },
  { filter: 'tracks', label: 'Temas' },
  { filter: 'albums', label: 'Álbumes' },
  { filter: 'artists', label: 'Artistas' },
  { filter: 'playlists', label: 'Playlists' }
]

const SEARCH_DEBOUNCE_MS = 350

/**
 * Winamp-style "Add from TIDAL" window (ADD button of the playlist, or J):
 * search or browse the library and play or enqueue tracks, albums, playlists,
 * artists and mixes — whole or one song at a time.
 */
export class SearchDialog {
  private history: View[] = [{ kind: 'home' }]
  private filter: Filter = 'all'
  private connected = false
  private loadToken = 0
  private searchTimer: ReturnType<typeof setTimeout> | undefined
  private lastResults: SearchResults | undefined
  private placed: boolean

  private input = el('input', { type: 'search', className: 'ml-search', placeholder: 'Buscar temas, álbumes, artistas…' })
  private filters = el('div', { className: 'sd-filters' })
  private back = el('button', { className: 'ml-back', textContent: '◂', title: 'Volver (Retroceso)' })
  private crumb = el('div', { className: 'ml-list-title' })
  private actions = el('div', { className: 'ml-list-actions' })
  private list = el('div', { className: 'ml-content sd-list', tabIndex: 0 })

  constructor(
    private readonly root: HTMLElement,
    private readonly controller: RemoteController
  ) {
    const titlebar = el(
      'div',
      { className: 'ml-titlebar' },
      el('span', {}, 'AGREGAR DESDE TIDAL'),
      el(
        'div',
        { className: 'ml-titlebar-actions' },
        el('button', { textContent: '×', title: 'Cerrar (Esc)', onclick: () => this.close() })
      )
    )
    root.append(
      titlebar,
      el('div', { className: 'sd-top' }, this.input, this.filters),
      el('div', { className: 'ml-list-header sd-header' }, this.back, this.crumb, this.actions),
      this.list,
      el('div', { className: 'sd-hint' }, '▶ reproducir · + agregar a la playlist · ↑↓ elegir · Enter abrir/reproducir · Ctrl+Enter agregar · Esc cerrar')
    )
    this.placed = makeFloating(root, titlebar, 'search-position-v1')

    this.back.onclick = () => this.goBack()
    this.input.addEventListener('input', () => this.scheduleSearch())
    this.input.addEventListener('keydown', (event) => this.onInputKey(event))
    root.addEventListener('keydown', (event) => this.onKey(event))
    favorites.listeners.add(() => refreshHearts(this.list, this.connected))
    document.addEventListener('search:open', () => void this.open())
    this.renderFilters()
  }

  // ---- Open / close --------------------------------------------------------------

  async open(): Promise<void> {
    this.root.classList.remove('hidden')
    if (!this.placed) centerOnPrimary(this.root)
    this.placed = true
    keepOnScreen(this.root)
    this.input.focus()
    this.input.select()
    this.connected = (await window.remote.getAuth()).connected
    if (this.history.length === 1) void this.show()
  }

  close(): void {
    this.root.classList.add('hidden')
  }

  // ---- Navigation --------------------------------------------------------------

  private get view(): View {
    return this.history[this.history.length - 1]
  }

  private navigate(view: View): void {
    this.history.push(view)
    void this.show()
  }

  private goBack(): void {
    if (this.history.length > 1) this.history.pop()
    void this.show()
  }

  private scheduleSearch(): void {
    clearTimeout(this.searchTimer)
    this.searchTimer = setTimeout(() => this.runSearch(), SEARCH_DEBOUNCE_MS)
  }

  private runSearch(): void {
    clearTimeout(this.searchTimer)
    const query = this.input.value.trim()
    // Typing replaces the current search instead of stacking history entries.
    while (this.history.length > 1 && this.view.kind === 'search') this.history.pop()
    if (query) this.history = [{ kind: 'home' }, { kind: 'search', query }]
    else this.history = [{ kind: 'home' }]
    void this.show()
  }

  private renderFilters(): void {
    this.filters.replaceChildren(
      ...FILTERS.map(({ filter, label }) =>
        el('button', {
          className: `sd-filter ${filter === this.filter ? 'active' : ''}`,
          textContent: label,
          onclick: () => {
            this.filter = filter
            this.renderFilters()
            if (this.view.kind === 'search' && this.lastResults) this.renderSearch(this.lastResults)
          }
        })
      )
    )
  }

  // ---- Rendering -----------------------------------------------------------------

  private message(text: string, ...extra: Node[]): void {
    this.list.replaceChildren(el('div', { className: 'ml-empty' }, text, ...extra))
  }

  private async show(): Promise<void> {
    const view = this.view
    const token = ++this.loadToken
    const stale = (): boolean => token !== this.loadToken
    this.back.hidden = this.history.length < 2
    this.actions.replaceChildren()
    this.filters.hidden = view.kind !== 'search'

    if (!this.connected) {
      this.crumb.textContent = ''
      const connect = el('button', {
        textContent: 'Conectar TIDAL',
        onclick: async () => {
          try {
            this.connected = (await window.remote.connect()).connected
          } catch {
            return
          }
          document.dispatchEvent(new CustomEvent('auth:changed'))
          void this.show()
        }
      })
      this.message('Conectá TIDAL para buscar y elegir música. ', el('br'), el('br'), connect)
      return
    }

    try {
      if (view.kind === 'home') {
        this.crumb.textContent = 'Tu biblioteca'
        this.renderHome()
      } else if (view.kind === 'search') {
        this.crumb.textContent = `Búsqueda: ${view.query}`
        this.message('Buscando…')
        const results = await window.remote.search(view.query)
        if (stale()) return
        this.lastResults = results
        this.renderSearch(results)
      } else if (view.kind === 'liked') {
        this.crumb.textContent = '♥ Temas favoritos'
        this.message('Cargando…')
        const tracks = await library.liked()
        if (!stale()) this.renderTracks(tracks, true)
      } else if (view.kind === 'section') {
        this.crumb.textContent = SECTIONS.find((s) => s.section === view.section)?.label ?? ''
        this.message('Cargando…')
        const collections = await library.section(view.section)
        if (!stale()) this.renderCollections(collections)
      } else {
        const { collection } = view
        this.crumb.textContent = collection.subtitle ? `${collection.name} — ${collection.subtitle}` : collection.name
        this.message('Cargando…')
        const tracks = await library.tracks(collection)
        if (!stale()) this.renderTracks(tracks, true)
      }
    } catch {
      if (!stale()) this.message('No se pudo cargar')
    }
  }

  private renderHome(): void {
    const entry = (label: string, view: View): HTMLElement =>
      el('div', { className: 'sd-home-item', textContent: label, onclick: () => this.navigate(view) })
    this.list.replaceChildren(
      el('div', { className: 'ml-group' }, 'ELEGÍ DE TU BIBLIOTECA O BUSCÁ ARRIBA'),
      entry('♥  Temas favoritos', { kind: 'liked' }),
      ...SECTIONS.map(({ section, label }) => entry(`◉  ${label}`, { kind: 'section', section }))
    )
  }

  /** Track list; `asContext` plays the whole list from the chosen song (like an album). */
  private renderTracks(tracks: Track[], asContext: boolean): void {
    if (tracks.length) {
      this.actions.replaceChildren(
        el('button', { textContent: '▶ Todo', title: 'Reemplaza la playlist y reproduce', onclick: () => this.controller.loadList(tracks, 0) }),
        el('button', { textContent: '+ Todo', title: 'Agrega todo al final de la playlist', onclick: () => this.controller.enqueue(tracks) })
      )
    }
    this.list.replaceChildren(
      ...(tracks.length
        ? tracks.map((track, index) =>
            trackRow(
              track,
              index,
              {
                play: () => (asContext ? this.controller.loadList(tracks, index) : this.controller.enqueue([track], true)),
                add: () => this.controller.enqueue([track])
              },
              this.connected
            )
          )
        : [el('div', { className: 'ml-empty' }, 'Vacío')])
    )
  }

  private collectionActions(collection: Collection): { play(): void; add(): void } {
    return {
      play: () => void library.tracks(collection).then((tracks) => this.controller.loadList(tracks, 0)).catch(() => undefined),
      add: () => void library.tracks(collection).then((tracks) => this.controller.enqueue(tracks)).catch(() => undefined)
    }
  }

  private collectionRows(collections: Collection[]): HTMLElement[] {
    return collections.map((collection) =>
      collectionRow(collection, () => this.navigate({ kind: 'collection', collection }), this.collectionActions(collection))
    )
  }

  private renderCollections(collections: Collection[]): void {
    this.list.replaceChildren(
      ...(collections.length ? this.collectionRows(collections) : [el('div', { className: 'ml-empty' }, 'Nada por acá todavía')])
    )
  }

  private renderSearch(results: SearchResults): void {
    const show = (filter: Filter): boolean => this.filter === 'all' || this.filter === filter
    const groups: [Filter, string, HTMLElement[]][] = [
      [
        'tracks',
        'TEMAS',
        results.tracks.map((track, index) =>
          trackRow(
            track,
            index,
            { play: () => this.controller.enqueue([track], true), add: () => this.controller.enqueue([track]) },
            this.connected
          )
        )
      ],
      ['albums', 'ÁLBUMES (CD)', this.collectionRows(results.albums)],
      ['artists', 'ARTISTAS', this.collectionRows(results.artists)],
      ['playlists', 'PLAYLISTS', this.collectionRows(results.playlists)]
    ]
    const nodes = groups
      .filter(([filter, , rows]) => show(filter) && rows.length)
      .flatMap(([, label, rows]) => [el('div', { className: 'ml-group' }, label), ...rows])
    this.list.replaceChildren(...(nodes.length ? nodes : [el('div', { className: 'ml-empty' }, 'Sin resultados')]))
  }

  // ---- Keyboard ------------------------------------------------------------------

  private rows(): HTMLElement[] {
    return [...this.list.querySelectorAll<HTMLElement>('.ml-track, .ml-collection, .sd-home-item')]
  }

  private select(index: number): void {
    const rows = this.rows()
    if (!rows.length) return
    const next = Math.max(0, Math.min(rows.length - 1, index))
    rows.forEach((row, i) => row.classList.toggle('sd-selected', i === next))
    rows[next].scrollIntoView({ block: 'nearest' })
  }

  private selectedIndex(): number {
    return this.rows().findIndex((row) => row.classList.contains('sd-selected'))
  }

  private onInputKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && this.selectedIndex() < 0) {
      event.preventDefault()
      this.runSearch()
    } else if (event.key === 'Backspace' && !this.input.value && this.history.length > 1) {
      this.goBack()
    }
  }

  private onKey(event: KeyboardEvent): void {
    // Keep Webamp's hotkeys (z, x, c, v, b…) from firing while typing here.
    event.stopPropagation()
    const current = this.selectedIndex()
    if (event.key === 'Escape') {
      this.close()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.select(current + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      this.select(current - 1)
    } else if (event.key === 'Enter' && current >= 0) {
      // Tracks: Enter plays, Ctrl+Enter enqueues. Albums/artists/playlists: Enter
      // opens them to pick songs, Shift+Enter plays all, Ctrl+Enter enqueues all.
      event.preventDefault()
      const row = this.rows()[current]
      const isTrack = row.classList.contains('ml-track')
      const action = event.ctrlKey ? '.row-add' : isTrack || event.shiftKey ? '.row-play' : null
      const button = action ? row.querySelector<HTMLElement>(action) : null
      if (button) button.click()
      else row.click()
    } else if (event.key === 'ArrowRight' && current >= 0) {
      this.rows()[current].click()
    }
  }
}
