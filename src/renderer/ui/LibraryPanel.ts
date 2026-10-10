import type { AuthInfo, Collection, EqStatus, PlaybackState, SearchResults, Track } from '@shared/types'
import type { RemoteController } from '../webamp/controller'
import { makeFloating } from './desktop'

export interface SkinActions {
  pick(): void
  reset(): void
}

type Section = 'mixes' | 'playlists' | 'albums' | 'artists'

type View =
  | { kind: 'liked' }
  | { kind: 'section'; section: Section }
  | { kind: 'collection'; collection: Collection }
  | { kind: 'search'; query: string }

const SECTIONS: { section: Section; label: string; load: () => Promise<Collection[]> }[] = [
  { section: 'mixes', label: 'Mixes para vos', load: () => window.remote.getMixes() },
  { section: 'playlists', label: 'Playlists', load: () => window.remote.getPlaylists() },
  { section: 'albums', label: 'Álbumes', load: () => window.remote.getAlbums() },
  { section: 'artists', label: 'Artistas', load: () => window.remote.getArtists() }
]

const EQ_APO_URL = 'https://sourceforge.net/projects/equalizerapo/'

const formatDuration = (ms: number): string => {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node, props)
  node.append(...children)
  return node
}

const sameView = (a: View | undefined, b: View): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Winamp "Media Library"-style window for the TIDAL library. */
export class LibraryPanel {
  private auth: AuthInfo = { configured: false, connected: false }
  private eq: EqStatus = { installed: false }
  private liked = new Set<string>()
  private history: View[] = []
  private cache = new Map<string, Collection[] | Track[]>()
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
        el('button', { textContent: 'Skin…', title: 'Cargar un skin .wsz', onclick: () => skins.pick() }),
        el('button', { textContent: 'Skin base', title: 'Volver al skin clásico', onclick: () => skins.reset() }),
        el('button', {
          textContent: '×',
          title: 'Ocultar (L)',
          onclick: () => root.classList.add('hidden')
        })
      )
    )
    root.append(titlebar, this.status, this.body, this.nowPlaying)
    makeFloating(root, titlebar, 'library-position')
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
    window.remote.onLiked((ids) => {
      this.liked = new Set(ids)
      this.refreshHearts()
    })
    document.addEventListener('library:toggle', () => root.classList.toggle('hidden'))
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
    this.liked = new Set(liked)
    this.renderStatus()
    this.renderNav()
    if (auth.connected) await this.open({ kind: 'liked' })
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
      tidal.push(el('span', { className: 'ml-warn' }, `⚠ ${this.auth.hint ?? 'TIDAL sin configurar'}`))
    } else if (this.auth.connected) {
      tidal.push(
        el('span', { className: 'ml-ok' }, '● TIDAL conectado'),
        el('button', { textContent: 'Desconectar', onclick: () => void this.connect(false) })
      )
    } else {
      tidal.push(el('button', { textContent: 'Conectar TIDAL', onclick: () => void this.connect(true) }))
    }

    const eq: (Node | string)[] = this.eq.error
      ? [el('span', { className: 'ml-warn', title: this.eq.error }, '⚠ EQ sin permisos')]
      : this.eq.installed
        ? [el('span', { className: 'ml-ok', title: this.eq.configDir ?? '' }, '● EQ activo')]
        : [
            el('a', {
              href: EQ_APO_URL,
              target: '_blank',
              textContent: 'Instalar Equalizer APO',
              title: 'Necesario para que el ecualizador del Winamp suene'
            })
          ]

    this.status.replaceChildren(
      el('div', { className: 'ml-status-group' }, ...tidal),
      el('div', { className: 'ml-status-group' }, ...eq)
    )
  }

  private async connect(connect: boolean): Promise<void> {
    this.status.replaceChildren(connect ? 'Abriendo el login de TIDAL en el navegador…' : 'Desconectando…')
    try {
      this.auth = await (connect ? window.remote.connect() : window.remote.disconnect())
    } catch {
      this.auth = await window.remote.getAuth()
    }
    this.cache.clear()
    this.history = []
    this.renderStatus()
    this.renderNav()
    if (this.auth.connected) await this.open({ kind: 'liked' })
    else this.renderWelcome()
  }

  // ---- Navigation --------------------------------------------------------------

  private get view(): View | undefined {
    return this.history[this.history.length - 1]
  }

  private renderNav(): void {
    this.body.classList.toggle('disconnected', !this.auth.connected)
    this.search.disabled = !this.auth.connected
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
        this.auth.configured
          ? 'Conectá TIDAL para ver tus favoritos, mixes, playlists, álbumes y artistas. Los controles del Winamp ya funcionan sin conectar.'
          : 'Configurá el client id de TIDAL en .env (ver README). Los controles del Winamp ya funcionan.'
      )
    )
  }

  private goBack(): void {
    if (this.history.length < 2) return
    this.history.pop()
    const previous = this.history.pop()!
    void this.open(previous)
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
        const tracks = await this.cached('liked', () => window.remote.getLikedTracks())
        if (!stale()) this.showTracks(tracks as Track[])
      } else if (view.kind === 'section') {
        const section = SECTIONS.find((s) => s.section === view.section)!
        this.title.textContent = section.label
        const collections = await this.cached(view.section, section.load)
        if (!stale()) this.showCollections(collections as Collection[])
      } else if (view.kind === 'collection') {
        const { collection } = view
        this.title.textContent = collection.subtitle ? `${collection.name} — ${collection.subtitle}` : collection.name
        const tracks = await this.cached(`${collection.kind}:${collection.id}`, () =>
          window.remote.getTracks(collection)
        )
        if (!stale()) this.showTracks(tracks as Track[])
      } else {
        this.title.textContent = `Búsqueda: ${view.query}`
        const results = await window.remote.search(view.query)
        if (!stale()) this.showSearch(results)
      }
    } catch {
      if (!stale()) this.content.replaceChildren(el('div', { className: 'ml-empty' }, 'No se pudo cargar'))
    }
  }

  private async cached<T extends Collection[] | Track[]>(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.cache.has(key)) this.cache.set(key, await load())
    return this.cache.get(key) as T
  }

  // ---- Rendering -----------------------------------------------------------------

  private heart(trackId: string | undefined): HTMLElement {
    const liked = trackId != null && this.liked.has(trackId)
    return el('button', {
      className: `ml-heart ${liked ? 'liked' : ''}`,
      textContent: liked ? '♥' : '♡',
      title: liked ? 'Quitar de favoritos' : 'Agregar a favoritos',
      disabled: trackId == null || !this.auth.connected,
      onclick: (event: MouseEvent) => {
        event.stopPropagation()
        if (!trackId) return
        this.cache.delete('liked')
        void window.remote.setLiked(trackId, !liked).catch(() => undefined)
      }
    })
  }

  private refreshHearts(): void {
    for (const row of this.content.querySelectorAll<HTMLElement>('[data-track-id]')) {
      row.querySelector('.ml-heart')?.replaceWith(this.heart(row.dataset.trackId))
    }
    this.nowPlaying.querySelector('.ml-heart')?.replaceWith(this.heart(this.nowPlayingTrackId))
  }

  private trackRows(tracks: Track[]): HTMLElement[] {
    return tracks.map((track, index) => {
      const row = el(
        'div',
        {
          className: 'ml-track',
          title: 'Doble click para reproducir',
          ondblclick: () => this.controller.loadList(tracks, index)
        },
        el('span', { className: 'n' }, String(index + 1)),
        this.heart(track.id),
        el('span', { className: 't' }, track.title),
        el('span', { className: 'a' }, track.artist),
        el('span', { className: 'd' }, formatDuration(track.durationMs))
      )
      row.dataset.trackId = track.id
      return row
    })
  }

  private showTracks(tracks: Track[]): void {
    if (tracks.length) {
      this.actions.replaceChildren(
        el('button', { textContent: '▶ Reproducir', onclick: () => this.controller.loadList(tracks, 0) }),
        el('button', {
          textContent: '⤮ Aleatorio',
          onclick: () => {
            const shuffled = [...tracks].sort(() => Math.random() - 0.5)
            this.controller.loadList(shuffled, 0)
          }
        }),
        el('button', { textContent: '+ Enviar al Winamp', onclick: () => this.controller.loadList(tracks) })
      )
    }
    this.content.replaceChildren(
      ...(tracks.length ? this.trackRows(tracks) : [el('div', { className: 'ml-empty' }, 'Vacío')])
    )
  }

  private collectionRows(collections: Collection[]): HTMLElement[] {
    return collections.map((collection) =>
      el(
        'div',
        {
          className: 'ml-collection',
          onclick: () => void this.open({ kind: 'collection', collection })
        },
        collection.artworkUrl
          ? el('img', { src: collection.artworkUrl, alt: '', loading: 'lazy' })
          : el('div', { className: 'ml-cover-placeholder' }, '♫'),
        el(
          'div',
          { className: 'ml-collection-text' },
          el('div', { className: 'name' }, collection.name),
          el(
            'div',
            { className: 'sub' },
            [collection.subtitle, collection.trackCount != null ? `${collection.trackCount} temas` : '']
              .filter(Boolean)
              .join(' · ')
          )
        )
      )
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
    const groups: [string, HTMLElement[]][] = [
      ['TEMAS', this.trackRows(results.tracks)],
      ['ÁLBUMES', this.collectionRows(results.albums)],
      ['ARTISTAS', this.collectionRows(results.artists)],
      ['PLAYLISTS', this.collectionRows(results.playlists)]
    ]
    const nodes = groups
      .filter(([, rows]) => rows.length)
      .flatMap(([label, rows]) => [el('div', { className: 'ml-group' }, label), ...rows])
    if (results.tracks.length) {
      this.actions.replaceChildren(
        el('button', { textContent: '▶ Reproducir temas', onclick: () => this.controller.loadList(results.tracks, 0) })
      )
    }
    this.content.replaceChildren(...(nodes.length ? nodes : [el('div', { className: 'ml-empty' }, 'Sin resultados')]))
  }

  private renderNowPlaying(state: PlaybackState | null): void {
    this.nowPlayingTrackId = state?.trackId
    if (!state) {
      this.nowPlaying.replaceChildren(el('div', { className: 'ml-now-empty' }, 'TIDAL no está reproduciendo'))
      return
    }
    const current = this.nowPlaying.querySelector('img')
    const image = current && current.src === state.artworkUrl ? current : el('img', { src: state.artworkUrl ?? '', alt: '' })
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
      this.heart(state.trackId)
    )
  }
}
