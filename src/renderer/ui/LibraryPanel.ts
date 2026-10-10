import type { AuthInfo, Collection, EqStatus, PlaybackState, SearchResults, Track } from '@shared/types'
import type { RemoteController } from '../webamp/controller'
import { LIBRARY_POSITION_KEY, makeFloating } from './desktop'
import { favorites, library, SECTIONS, type Section } from './library'
import { collectionRow, el, heartButton, refreshHearts, trackRow } from './rows'

export interface SkinActions {
  pick(): void
  reset(): void
}

type View =
  | { kind: 'liked' }
  | { kind: 'section'; section: Section }
  | { kind: 'collection'; collection: Collection }
  | { kind: 'search'; query: string }

const EQ_APO_URL = 'https://sourceforge.net/projects/equalizerapo/'

const sameView = (a: View | undefined, b: View): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Winamp "Media Library"-style window for the TIDAL library. */
export class LibraryPanel {
  private auth: AuthInfo = { configured: false, connected: false, catalog: false }
  private eq: EqStatus = { installed: false }
  private history: View[] = []
  private loadToken = 0
  private nowPlayingTrackId: string | undefined

  private status = el('div', { className: 'ml-status' })
  private nav = el('nav', { className: 'ml-nav' })
  private back = el('button', { className: 'ml-back', textContent: '◂', title: 'Volver' })
  private title = el('div', { className: 'ml-list-title' })
  private actions = el('div', { className: 'ml-list-actions' })
  private content = el('div', { className: 'ml-content', tabIndex: 0 })
  private search = el('input', { type: 'search', placeholder: 'Buscar en TIDAL…', className: 'ml-search' })
  private body = el('div', { className: 'ml-body' })
  private nowPlaying = el('div', { className: 'ml-now' })

  constructor(
    root: HTMLElement,
    private readonly controller: RemoteController,
    skins: SkinActions
  ) {
    const titlebar = el(
      'div',
      { className: 'ml-titlebar', title: 'Arrastrá para mover · L o el botón eject para mostrar/ocultar' },
      el('span', {}, 'WINAMP MEDIA LIBRARY · TIDAL'),
      el(
        'div',
        { className: 'ml-titlebar-actions' },
        el('button', {
          textContent: 'TIDAL…',
          title: 'Solo control remoto, o buscar en TIDAL (modo catálogo)',
          onclick: () => document.dispatchEvent(new CustomEvent('setup:open'))
        }),
        el('button', { textContent: 'Skin…', title: 'Cargar un skin .wsz', onclick: () => skins.pick() }),
        el('button', { textContent: 'Skin base', title: 'Volver al skin clásico', onclick: () => skins.reset() }),
        el('button', { textContent: 'A−', title: 'Achicar todo (Ctrl −)', onclick: () => window.remote.scaleWindow('out') }),
        el('button', { textContent: 'A+', title: 'Agrandar todo (Ctrl +) · Ctrl 0 vuelve a 100%', onclick: () => window.remote.scaleWindow('in') }),
        el('button', { textContent: '×', title: 'Ocultar (L)', onclick: () => root.classList.add('hidden') })
      )
    )
    root.append(titlebar, this.status, this.body, this.nowPlaying)
    makeFloating(root, titlebar, LIBRARY_POSITION_KEY)
    this.body.append(
      el('div', { className: 'ml-side' }, this.search, this.nav),
      el(
        'section',
        { className: 'ml-main' },
        el('div', { className: 'ml-list-header' }, this.back, this.title, this.actions),
        this.content
      )
    )
    this.back.onclick = () => this.goBack()
    this.search.addEventListener('keydown', (event) => {
      const query = this.search.value.trim()
      if (event.key === 'Enter' && query) void this.open({ kind: 'search', query })
    })
    window.remote.onState((state) => this.renderNowPlaying(state))
    favorites.listeners.add(() => {
      refreshHearts(this.content, this.auth.connected)
      this.nowPlaying.querySelector('.ml-heart')?.replaceWith(heartButton(this.nowPlayingTrackId, this.auth.connected))
    })
    document.addEventListener('library:toggle', () => root.classList.toggle('hidden'))
    document.addEventListener('auth:changed', () => void this.refreshAuth())
    this.renderNowPlaying(null)
  }

  async init(): Promise<void> {
    const [auth, eq, liked] = await Promise.all([
      window.remote.getAuth(),
      window.remote.getEq(),
      window.remote.getLikedIds()
    ])
    this.auth = auth
    this.eq = eq
    favorites.set(liked)
    this.renderStatus()
    this.renderNav()
    if (auth.connected) await this.open({ kind: 'liked' }, true)
    else this.renderWelcome()
  }

  setEqStatus(eq: EqStatus): void {
    this.eq = eq
    this.renderStatus()
  }

  // ---- Status bar ------------------------------------------------------------

  private renderStatus(): void {
    const tidal: (Node | string)[] = []
    if (!this.auth.configured) {
      tidal.push(
        el('span', { className: 'ml-ok' }, `● ${this.auth.hint ?? 'Solo control remoto'}`),
        el('button', {
          textContent: 'Buscar en TIDAL…',
          onclick: () => document.dispatchEvent(new CustomEvent('setup:open'))
        })
      )
    } else if (this.auth.connected) {
      tidal.push(
        el('span', { className: 'ml-ok' }, '● TIDAL conectado'),
        el('button', { textContent: 'Desconectar', onclick: () => void this.connect(false) })
      )
    } else {
      if (this.auth.catalog) {
        tidal.push(el('span', { className: 'ml-ok', title: 'Búsqueda y catálogo sin login' }, '● Modo catálogo'))
      }
      tidal.push(el('button', { textContent: 'Conectar TIDAL', onclick: () => void this.connect(true) }))
    }

    const eq: (Node | string)[] = this.eq.error
      ? [el('span', { className: 'ml-warn', title: this.eq.error }, '⚠ EQ sin permisos')]
      : this.eq.installed
        ? [el('span', { className: 'ml-ok', title: this.eq.configDir ?? '' }, '● EQ activo')]
        : [el('a', { href: EQ_APO_URL, target: '_blank', textContent: 'Instalar Equalizer APO' })]

    this.status.replaceChildren(
      el('div', { className: 'ml-status-group' }, ...tidal),
      el(
        'div',
        { className: 'ml-status-group' },
        el('button', {
          textContent: '+ Agregar desde TIDAL',
          title: 'Buscar y elegir temas, álbumes, artistas o playlists (J)',
          onclick: () => document.dispatchEvent(new CustomEvent('search:open'))
        }),
        ...eq
      )
    )
  }

  private async connect(connect: boolean): Promise<void> {
    this.status.replaceChildren(connect ? 'Abriendo el login de TIDAL en el navegador…' : 'Desconectando…')
    try {
      await (connect ? window.remote.connect() : window.remote.disconnect())
    } catch {
      // the error toast explains what happened
    }
    await this.refreshAuth()
  }

  private async refreshAuth(): Promise<void> {
    this.auth = await window.remote.getAuth()
    library.invalidate()
    this.history = []
    this.renderStatus()
    this.renderNav()
    if (this.auth.connected) await this.open({ kind: 'liked' }, true)
    else this.renderWelcome()
  }

  // ---- Navigation --------------------------------------------------------------

  private get view(): View | undefined {
    return this.history[this.history.length - 1]
  }

  private renderNav(): void {
    this.body.classList.toggle('disconnected', !this.auth.connected)
    this.search.disabled = !this.auth.catalog
    const item = (label: string, view: View): HTMLElement =>
      el('div', {
        className: `ml-nav-item ${sameView(this.view, view) ? 'selected' : ''}`,
        textContent: label,
        onclick: () => void this.open(view, true)
      })
    this.nav.replaceChildren(
      item('♥ Temas favoritos', { kind: 'liked' }),
      ...SECTIONS.map(({ section, label }) => item(label, { kind: 'section', section }))
    )
  }

  private renderWelcome(): void {
    this.history = []
    this.title.textContent = ''
    this.actions.replaceChildren()
    this.back.hidden = true
    this.content.replaceChildren(
      el(
        'div',
        { className: 'ml-empty' },
        !this.auth.configured
          ? 'Modo solo control remoto: elegí la música en la app de TIDAL y manejala desde el Winamp. Para buscar en TIDAL desde acá tocá "TIDAL…" arriba.'
          : this.auth.catalog
            ? 'Modo catálogo: buscá arriba (o con "+ Agregar desde TIDAL") cualquier tema, disco, artista o playlist pública y reproducilo o sumalo a la playlist. Tus favoritos, mixes y playlists aparecen cuando TIDAL habilite el login de la app.'
            : 'Tocá "Conectar TIDAL" arriba para ver tu biblioteca. Los controles del Winamp ya funcionan sin conectar.'
      )
    )
  }

  private goBack(): void {
    if (this.history.length < 2) return
    this.history.pop()
    void this.open(this.history.pop()!)
  }

  private async open(view: View, root = false): Promise<void> {
    if (root) this.history = []
    if (!sameView(this.view, view)) this.history.push(view)
    this.back.hidden = this.history.length < 2
    this.renderNav()
    const token = ++this.loadToken
    const stale = (): boolean => token !== this.loadToken

    this.actions.replaceChildren()
    this.content.replaceChildren(el('div', { className: 'ml-empty' }, 'Cargando…'))
    try {
      if (view.kind === 'liked') {
        this.title.textContent = '♥ Temas favoritos'
        const tracks = await library.liked()
        if (!stale()) this.showTracks(tracks)
      } else if (view.kind === 'section') {
        this.title.textContent = SECTIONS.find((s) => s.section === view.section)!.label
        const collections = await library.section(view.section)
        if (!stale()) this.showCollections(collections)
      } else if (view.kind === 'collection') {
        const { collection } = view
        this.title.textContent = collection.subtitle ? `${collection.name} — ${collection.subtitle}` : collection.name
        const tracks = await library.tracks(collection)
        if (!stale()) this.showTracks(tracks)
      } else {
        this.title.textContent = `Búsqueda: ${view.query}`
        const results = await window.remote.search(view.query)
        if (!stale()) this.showSearch(results)
      }
    } catch {
      if (!stale()) this.content.replaceChildren(el('div', { className: 'ml-empty' }, 'No se pudo cargar'))
    }
  }

  // ---- Rendering -----------------------------------------------------------------

  private showTracks(tracks: Track[]): void {
    if (tracks.length) {
      this.actions.replaceChildren(
        el('button', { textContent: '▶ Reproducir', onclick: () => this.controller.loadList(tracks, 0) }),
        el('button', {
          textContent: '⤮ Aleatorio',
          onclick: () => this.controller.loadList([...tracks].sort(() => Math.random() - 0.5), 0)
        }),
        el('button', { textContent: '+ Agregar todo', onclick: () => this.controller.enqueue(tracks) })
      )
    }
    this.content.replaceChildren(
      ...(tracks.length
        ? tracks.map((track, index) =>
            trackRow(
              track,
              index,
              { play: () => this.controller.loadList(tracks, index), add: () => this.controller.enqueue([track]) },
              this.auth.connected
            )
          )
        : [el('div', { className: 'ml-empty' }, 'Vacío')])
    )
  }

  private collectionRows(collections: Collection[]): HTMLElement[] {
    return collections.map((collection) =>
      collectionRow(collection, () => void this.open({ kind: 'collection', collection }), {
        play: () => void library.tracks(collection).then((t) => this.controller.loadList(t, 0)).catch(() => undefined),
        add: () => void library.tracks(collection).then((t) => this.controller.enqueue(t)).catch(() => undefined)
      })
    )
  }

  private showCollections(collections: Collection[]): void {
    this.content.replaceChildren(
      ...(collections.length
        ? this.collectionRows(collections)
        : [el('div', { className: 'ml-empty' }, 'Nada por acá todavía')])
    )
  }

  private showSearch(results: SearchResults): void {
    const trackRows = results.tracks.map((track, index) =>
      trackRow(
        track,
        index,
        { play: () => this.controller.enqueue([track], true), add: () => this.controller.enqueue([track]) },
        this.auth.connected
      )
    )
    const groups: [string, HTMLElement[]][] = [
      ['TEMAS', trackRows],
      ['ÁLBUMES (CD)', this.collectionRows(results.albums)],
      ['ARTISTAS', this.collectionRows(results.artists)],
      ['PLAYLISTS', this.collectionRows(results.playlists)]
    ]
    const nodes = groups
      .filter(([, rows]) => rows.length)
      .flatMap(([label, rows]) => [el('div', { className: 'ml-group' }, label), ...rows])
    this.content.replaceChildren(...(nodes.length ? nodes : [el('div', { className: 'ml-empty' }, 'Sin resultados')]))
  }

  private renderNowPlaying(state: PlaybackState | null): void {
    this.nowPlayingTrackId = state?.trackId
    if (!state) {
      this.nowPlaying.replaceChildren(el('div', { className: 'ml-now-empty' }, 'TIDAL no está reproduciendo'))
      return
    }
    const current = this.nowPlaying.querySelector('img')
    const image =
      current && current.src === state.artworkUrl ? current : el('img', { src: state.artworkUrl ?? '', alt: '' })
    image.hidden = !state.artworkUrl
    this.nowPlaying.replaceChildren(
      image,
      el(
        'div',
        { className: 'ml-now-text' },
        el('div', { className: 'ml-now-title' }, state.title),
        el('div', {}, state.artist),
        el('div', { className: 'ml-now-dim' }, state.album ?? '')
      ),
      heartButton(state.trackId, this.auth.connected)
    )
  }
}
