import type { PlaybackState, Playlist, ProviderId, ProviderInfo, Track } from '@shared/types'
import type { RemoteController } from '../webamp/controller'

type View =
  | { kind: 'liked' }
  | { kind: 'search'; query: string }
  | { kind: 'playlist'; playlist: Playlist }

const formatDuration = (ms: number): string => {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  const { dataset, ...rest } = props
  Object.assign(node, rest)
  if (dataset) Object.assign(node.dataset, dataset)
  node.append(...children)
  return node
}

/** Winamp "Media Library"-style window: provider picker, playlists, liked songs and search. */
export class LibraryPanel {
  private providers: ProviderInfo[] = []
  private active: ProviderId = 'system'
  private playlists: Playlist[] = []
  private view: View | undefined
  private tracks: Track[] = []
  private loadToken = 0

  private providerBar = el('div', { className: 'ml-providers' })
  private status = el('div', { className: 'ml-status' })
  private nav = el('nav', { className: 'ml-nav' })
  private listTitle = el('div', { className: 'ml-list-title' })
  private listActions = el('div', { className: 'ml-list-actions' })
  private trackTable = el('div', { className: 'ml-tracks', tabIndex: 0 })
  private searchInput = el('input', { type: 'search', placeholder: 'Buscar canciones…', className: 'ml-search' })
  private body = el('div', { className: 'ml-body' })
  private nowPlaying = el('div', { className: 'ml-now' })

  constructor(
    private readonly root: HTMLElement,
    private readonly controller: RemoteController
  ) {
    root.append(
      el('div', { className: 'ml-titlebar' }, 'WINAMP MEDIA LIBRARY'),
      this.providerBar,
      this.status,
      this.body,
      this.nowPlaying
    )
    this.body.append(
      el('div', { className: 'ml-side' }, this.searchInput, this.nav),
      el(
        'section',
        { className: 'ml-main' },
        el('div', { className: 'ml-list-header' }, this.listTitle, this.listActions),
        this.trackTable
      )
    )
    window.remote.onState((state) => this.renderNowPlaying(state))
    this.renderNowPlaying(null)
    this.searchInput.addEventListener('keydown', (event) => {
      const query = this.searchInput.value.trim()
      if (event.key === 'Enter' && query) void this.open({ kind: 'search', query })
    })
    window.remote.onProviders((providers) => {
      this.providers = providers
      this.renderProviders()
    })
    document.addEventListener('library:toggle', () => root.classList.toggle('hidden'))
  }

  async init(): Promise<void> {
    const [providers, settings] = await Promise.all([window.remote.listProviders(), window.remote.getSettings()])
    this.providers = providers
    this.active = settings.provider
    this.renderProviders()
    await this.loadLibrary()
  }

  private get activeInfo(): ProviderInfo | undefined {
    return this.providers.find((p) => p.id === this.active)
  }

  // ---- Providers ---------------------------------------------------------

  private renderProviders(): void {
    this.providerBar.replaceChildren(
      ...this.providers.map((provider) =>
        el('button', {
          className: `ml-provider ${provider.id === this.active ? 'active' : ''}`,
          textContent: provider.name,
          title: provider.connected ? 'Conectado' : 'No conectado',
          onclick: () => void this.selectProvider(provider.id)
        })
      )
    )

    const info = this.activeInfo
    if (!info) return
    const parts: (Node | string)[] = []
    if (info.setupHint) {
      parts.push(el('span', { className: 'ml-warn' }, `⚠ ${info.setupHint}`))
    } else if (info.id === 'system') {
      parts.push('Controla el reproductor activo de Windows (sin biblioteca).')
    } else if (info.connected) {
      parts.push(
        el('span', { className: 'ml-ok' }, '● Conectado'),
        el('button', { textContent: 'Desconectar', onclick: () => void this.connect(false) })
      )
    } else {
      parts.push(
        el('span', {}, 'Sin conectar  '),
        el('button', { textContent: `Conectar ${info.name}`, onclick: () => void this.connect(true) })
      )
    }
    this.status.replaceChildren(...parts)
  }

  private renderNowPlaying(state: PlaybackState | null): void {
    if (!state) {
      this.nowPlaying.replaceChildren(el('div', { className: 'ml-now-empty' }, 'Nada sonando'))
      return
    }
    const art = this.nowPlaying.querySelector('img')
    const image =
      art?.src === state.artworkUrl && art ? art : el('img', { src: state.artworkUrl ?? '', alt: '' })
    image.hidden = !state.artworkUrl
    this.nowPlaying.replaceChildren(
      image,
      el(
        'div',
        { className: 'ml-now-text' },
        el('div', { className: 'ml-now-title' }, state.title),
        el('div', {}, state.artist),
        el('div', { className: 'ml-now-dim' }, [state.album, state.device && `en ${state.device}`].filter(Boolean).join(' · '))
      )
    )
  }

  private async selectProvider(id: ProviderId): Promise<void> {
    if (id === this.active) return
    this.active = id
    await window.remote.selectProvider(id)
    this.controller.clearList()
    this.renderProviders()
    await this.loadLibrary()
  }

  private async connect(connect: boolean): Promise<void> {
    const info = this.activeInfo
    if (!info) return
    this.status.replaceChildren(connect ? 'Abriendo el login en el navegador…' : 'Desconectando…')
    try {
      await (connect ? window.remote.connect(info.id) : window.remote.disconnect(info.id))
    } catch {
      // error already shown by the toast
    }
    this.providers = await window.remote.listProviders()
    this.renderProviders()
    await this.loadLibrary()
  }

  // ---- Library -----------------------------------------------------------

  private async loadLibrary(): Promise<void> {
    const info = this.activeInfo
    const usable = !!info?.capabilities.library && info.connected
    this.body.hidden = !usable
    this.playlists = []
    this.view = undefined
    this.renderNav()
    this.renderTracks([], usable ? 'Elegí una playlist' : '')
    if (!usable) return
    try {
      this.playlists = await window.remote.getPlaylists()
    } catch {
      this.playlists = []
    }
    this.renderNav()
  }

  private renderNav(): void {
    const info = this.activeInfo
    if (!info?.capabilities.library || !info.connected) {
      this.nav.replaceChildren()
      return
    }
    const item = (label: string, view: View, selected: boolean, title = ''): HTMLElement =>
      el('div', {
        className: `ml-nav-item ${selected ? 'selected' : ''}`,
        textContent: label,
        title,
        onclick: () => void this.open(view)
      })
    const current = this.view
    this.nav.replaceChildren(
      item('♥ Me gusta', { kind: 'liked' }, current?.kind === 'liked'),
      el('div', { className: 'ml-nav-heading' }, `PLAYLISTS (${this.playlists.length})`),
      ...this.playlists.map((playlist) =>
        item(
          playlist.name,
          { kind: 'playlist', playlist },
          current?.kind === 'playlist' && current.playlist.id === playlist.id,
          playlist.trackCount != null ? `${playlist.trackCount} temas` : ''
        )
      )
    )
  }

  private async open(view: View): Promise<void> {
    this.view = view
    this.renderNav()
    const token = ++this.loadToken
    const title =
      view.kind === 'liked' ? 'Me gusta' : view.kind === 'search' ? `Búsqueda: ${view.query}` : view.playlist.name

    if (view.kind === 'playlist' && !view.playlist.tracksListable) {
      this.tracks = []
      this.renderTracks([], title, 'Spotify no permite listar playlists que no son tuyas, pero se pueden reproducir.')
      return
    }

    this.renderTracks([], title, 'Cargando…')
    try {
      const tracks =
        view.kind === 'liked'
          ? await window.remote.getLikedTracks()
          : view.kind === 'search'
            ? await window.remote.search(view.query)
            : await window.remote.getPlaylistTracks(view.playlist.id)
      if (token !== this.loadToken) return
      this.tracks = tracks
      this.renderTracks(tracks, title, tracks.length ? undefined : 'Sin resultados')
    } catch {
      if (token === this.loadToken) this.renderTracks([], title, 'No se pudo cargar')
    }
  }

  private playlistOfView(): Playlist | undefined {
    return this.view?.kind === 'playlist' ? this.view.playlist : undefined
  }

  private renderTracks(tracks: Track[], title: string, message?: string): void {
    this.listTitle.textContent = title
    const playlist = this.playlistOfView()
    const actions: HTMLElement[] = []
    if (tracks.length) {
      actions.push(
        el('button', {
          textContent: '▶ Reproducir',
          onclick: () => this.controller.loadList(tracks, playlist, 0)
        }),
        el('button', {
          textContent: '+ A la playlist de Winamp',
          onclick: () => this.controller.loadList(tracks, playlist)
        })
      )
    } else if (playlist && !playlist.tracksListable) {
      actions.push(
        el('button', {
          textContent: '▶ Reproducir playlist',
          onclick: () => void window.remote.playPlaylist(playlist).catch(() => undefined)
        })
      )
    }
    this.listActions.replaceChildren(...actions)

    if (message) {
      this.trackTable.replaceChildren(el('div', { className: 'ml-empty' }, message))
      return
    }
    this.trackTable.replaceChildren(
      ...tracks.map((track, index) =>
        el(
          'div',
          {
            className: 'ml-track',
            title: 'Doble click para reproducir',
            ondblclick: () => this.controller.loadList(tracks, playlist, index)
          },
          el('span', { className: 'n' }, String(index + 1)),
          el('span', { className: 't' }, track.title),
          el('span', { className: 'a' }, track.artist),
          el('span', { className: 'd' }, formatDuration(track.durationMs))
        )
      )
    )
  }
}
