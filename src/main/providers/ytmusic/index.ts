import type { Collection, PlayContext, PlayMode, PlaybackState, QueueAdd, SearchResults, Track, YtAccount, YtAccounts } from '@shared/types'
import { signInWithBrowser } from '../../auth/browserCookies'
import { settingsStore } from '../../auth/store'
import { pageAudio } from '../../platform/pageAudio'
import { PlayOrder } from '../playOrder'
import type { MusicProvider } from '../types'
import { YtCatalog } from './catalog'
import type { RawAccount } from './accounts'
import { YtPlayerWindow, YtState, type YtStatus } from './player'

const POLL_MS = 500

const thumbnail = (videoId: string): string => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

/**
 * YouTube Music, played inside the app (a hidden music.youtube.com window).
 * Search works without an account; signing in with Google adds the library.
 * The queue lives here, like with TIDAL: when a track ends the next one is loaded.
 */
export class YtMusicProvider implements MusicProvider {
  readonly id = 'ytmusic'
  readonly name = 'YouTube Music'
  readonly capabilities = { credentials: false, mixes: true, externalApp: false }

  private readonly window = new YtPlayerWindow()
  private readonly catalog = new YtCatalog()
  private queue: Track[] = []
  private index = -1
  private readonly order = new PlayOrder()
  private liked = new Set<string>()
  private lastStatus: YtStatus | null = null
  private accounts: RawAccount[] = []
  private current: RawAccount | undefined
  /** Resolves once the active account is known and applied to the catalog (reset when the login changes). */
  private accountReady: Promise<void> | undefined
  /** The video we asked for, until the player reports it. */
  private loading: string | undefined
  /** macOS: media keys / Now Playing next and previous go through our queue (no-op elsewhere). */
  private readonly offMedia = pageAudio.onMediaAction((action) =>
    void (action === 'next' ? this.next() : this.previous()).catch(() => undefined)
  )

  constructor(private readonly onLikedChange: (ids: string[]) => void) {
    void this.refreshCookie()
  }

  private async refreshCookie(): Promise<void> {
    this.catalog.setCookie(await this.window.cookie())
  }

  // ---- Auth ------------------------------------------------------------------

  get configured(): boolean {
    return true
  }
  get connected(): boolean {
    return this.catalog.loggedIn
  }
  get catalogAvailable(): boolean {
    return true
  }
  async login(): Promise<void> {
    // macOS: sign in with the session of the user's default browser (no embedded Google page).
    if (process.platform === 'darwin') return this.importSession(await signInWithBrowser())
    await this.window.login()
    await this.refreshCookie()
    this.resetAccount()
  }
  /** Signs in with cookies copied from the user's browser (see YtPlayerWindow.importCookies). */
  async importSession(text: string): Promise<void> {
    await this.window.importCookies(text)
    await this.refreshCookie()
    this.resetAccount()
  }
  async logout(): Promise<void> {
    await this.window.logout()
    await this.refreshCookie()
    this.resetAccount()
  }

  // ---- Accounts (channels) -------------------------------------------------------

  private resetAccount(): void {
    this.accountReady = undefined
    this.accounts = []
    this.current = undefined
    this.catalog.setAccount(undefined)
  }

  /**
   * Finds the channel to act as and applies it to the catalog. A choice made in the app wins
   * (and is pushed to the player); otherwise it follows whatever music.youtube.com is using.
   */
  private syncAccount(): Promise<void> {
    if (!this.connected) {
      this.resetAccount()
      return Promise.resolve()
    }
    if (!this.accountReady) {
      this.accountReady = (async () => {
        const accounts = await this.catalog.accounts()
        this.accounts = accounts
        if (!accounts.length) return
        const active = await this.window.activeChannel().catch(() => undefined)
        const playing = active === undefined ? undefined : accounts.find((a) => (a.pageId ?? '') === active)
        const wanted = accounts.find((a) => a.id === settingsStore.get().ytAccount)
        if (wanted?.signinUrl && playing?.id !== wanted.id) {
          await this.window.switchChannel(wanted.signinUrl).catch(() => undefined)
          await this.refreshCookie()
        }
        const chosen = wanted ?? playing ?? accounts.find((a) => a.selected) ?? accounts[0]
        this.current = chosen
        this.catalog.setAccount(chosen.pageId)
      })()
      this.accountReady.catch(() => (this.accountReady = undefined))
    }
    return this.accountReady
  }

  private view = ({ id, name, handle, email, photoUrl }: RawAccount): YtAccount => ({ id, name, handle, email, photoUrl })

  async accountsInfo(): Promise<YtAccounts> {
    await this.syncAccount()
    return { current: this.current && this.view(this.current), accounts: this.accounts.map(this.view) }
  }

  async selectAccount(id: string): Promise<YtAccounts> {
    await this.syncAccount()
    const target = this.accounts.find((a) => a.id === id)
    if (!target) throw new Error('Esa cuenta ya no está disponible. Volvé a iniciar sesión.')
    if (this.current?.id !== target.id) {
      if (!target.signinUrl) throw new Error('YouTube no permite cambiar a esa cuenta desde acá.')
      await this.window.switchChannel(target.signinUrl)
      if ((await this.window.activeChannel()) !== (target.pageId ?? '')) {
        throw new Error('No se pudo cambiar de cuenta en YouTube Music. Probá cambiarla desde tu navegador.')
      }
      await this.refreshCookie()
    }
    settingsStore.update({ ytAccount: target.id })
    this.current = target
    this.catalog.setAccount(target.pageId)
    await this.loadLiked()
    return this.accountsInfo()
  }
  async ensureUser(): Promise<void> {
    await this.refreshCookie()
    if (!this.connected) throw new Error('Iniciá sesión en YouTube Music para ver tu biblioteca')
    await this.syncAccount()
  }
  async ensureCatalog(): Promise<void> {}

  // ---- Catalog and library -----------------------------------------------------

  search(query: string): Promise<SearchResults> {
    return this.catalog.search(query)
  }
  collectionTracks(collection: Collection): Promise<Track[]> {
    return this.catalog.collectionTracks(collection)
  }
  likedTracks(): Promise<Track[]> {
    return this.catalog.likedTracks()
  }
  userPlaylists(): Promise<Collection[]> {
    return this.catalog.userPlaylists()
  }
  userAlbums(): Promise<Collection[]> {
    return this.catalog.userAlbums()
  }
  userArtists(): Promise<Collection[]> {
    return this.catalog.userArtists()
  }
  mixes(): Promise<Collection[]> {
    return this.catalog.mixes()
  }

  // ---- Favorites ---------------------------------------------------------------

  async loadLiked(): Promise<void> {
    await this.refreshCookie()
    await this.syncAccount().catch(() => undefined)
    this.liked = new Set(this.connected ? (await this.catalog.likedTracks()).map((t) => t.id) : [])
    this.onLikedChange([...this.liked])
  }
  likedIds(): string[] {
    return [...this.liked]
  }
  async setLiked(trackId: string, liked: boolean): Promise<void> {
    await this.syncAccount().catch(() => undefined)
    await this.catalog.setLiked(trackId, liked)
    if (liked) this.liked.add(trackId)
    else this.liked.delete(trackId)
    this.onLikedChange([...this.liked])
  }

  // ---- Playback ----------------------------------------------------------------
  //
  // The app's queue decides what plays: `PlayOrder` picks the next song (SHUF / REP), the page's own
  // autoplay is blocked (see YtPlayerWindow), and when the list is over a radio of the last song takes over.

  /** Set by the host: tracks the app appended by itself (radio), to mirror in the Winamp playlist. */
  queueAdded?: (added: QueueAdd) => void

  /** The song we asked for (the queue entry); `index` only hints where it was if it leaves the list. */
  private currentId: string | undefined
  /** The video id the player reports for it (normally the same). */
  private playerId: string | undefined
  /** The video that was playing when we asked, to tell the new one from the old one. */
  private prevVideo: string | undefined
  private loadingSince = 0
  /** Songs whose end was already handled, so polling advances only once. */
  private handledEnd: string | undefined
  /** Navigation (next, previous, end of song) runs one at a time, in order. */
  private nav: Promise<void> = Promise.resolve()
  private navigating = 0
  private radioPrefetch: { seed: string; tracks: Promise<Track[]> } | undefined

  private navigate(task: () => Promise<void>): Promise<void> {
    this.navigating++
    const run = this.nav.then(task)
    this.nav = run.catch(() => undefined).finally(() => void this.navigating--)
    return run
  }

  private async open(index: number): Promise<void> {
    const track = this.queue[index]
    if (!track) return
    this.index = index
    this.currentId = track.id
    this.playerId = undefined
    this.prevVideo = this.lastStatus?.videoId
    this.handledEnd = undefined
    this.loading = track.id
    this.loadingSince = Date.now()
    this.order.started(track.id)
    try {
      await this.window.load(track.id)
    } catch (error) {
      this.loading = undefined
      throw error
    }
  }

  async playTrack(context: PlayContext): Promise<void> {
    const same =
      context.tracks.length === this.queue.length && context.tracks.every((t, i) => t.id === this.queue[i]?.id)
    this.queue = context.tracks
    // A different list starts a new shuffle round and a new "previous" history.
    if (!same) this.order.reset()
    await this.navigate(() => this.open(context.index))
  }

  setQueue(tracks: Track[]): void {
    this.queue = tracks
    const at = this.currentId ? tracks.findIndex((t) => t.id === this.currentId) : -1
    if (at >= 0) this.index = at
  }

  setPlayMode(mode: PlayMode): void {
    // Turning shuffle on starts a fresh round (the current song counts as played).
    if (mode.shuffle && !this.order.shuffle) this.order.restartRound(this.currentId)
    this.order.shuffle = mode.shuffle
    this.order.repeat = mode.repeat
  }

  async resume(): Promise<void> {
    // Nothing loaded yet (e.g. right after start): play the selected queue entry.
    if (!this.lastStatus?.videoId && this.queue.length) return this.navigate(() => this.open(Math.max(0, this.index)))
    await this.window.play()
  }
  pause(): Promise<void> {
    return this.window.pause()
  }
  next(): Promise<void> {
    return this.navigate(() => this.advance())
  }
  previous(): Promise<void> {
    return this.navigate(async () => {
      // Like Winamp: restart the song unless we are at its very beginning.
      if ((this.lastStatus?.positionMs ?? 0) > 3000) return this.window.seek(0)
      const index = this.order.previous(this.queue, this.currentId, this.index)
      if (index < 0) return this.window.seek(0)
      await this.open(index)
    })
  }
  seek(positionMs: number): Promise<void> {
    return this.window.seek(positionMs)
  }

  /**
   * Plays what comes next; when the list is over, a radio of the last song (if enabled).
   * `auto`: the song ended by itself, so with nothing to continue the last song is shown stopped.
   */
  private async advance(auto = false): Promise<void> {
    const index = this.order.next(this.queue, this.currentId, this.index)
    if (index >= 0) return this.open(index)
    if (!(await this.continueWithRadio()) && auto && this.currentId) await this.window.cue(this.currentId)
  }

  // ---- Radio -------------------------------------------------------------------

  private radioEnabled = (): boolean => settingsStore.get().autoRadio !== false

  private radioOf(seed: string): Promise<Track[]> {
    if (this.radioPrefetch?.seed === seed) return this.radioPrefetch.tracks
    return this.catalog.radio(seed)
  }

  /** Returns whether a radio song started. */
  private async continueWithRadio(): Promise<boolean> {
    const seed = this.currentId
    if (!seed || !this.radioEnabled()) return false
    const title = this.queue.find((t) => t.id === seed)?.title
    let tracks: Track[]
    try {
      tracks = await this.radioOf(seed)
    } catch {
      this.queueAdded?.({ tracks: [], message: 'No se pudo armar la radio de YouTube Music. Revisá la conexión.' })
      return false
    }
    const known = new Set(this.queue.map((t) => t.id))
    const fresh = tracks.filter((t) => !known.has(t.id))
    if (!fresh.length) return false
    const start = this.queue.length
    this.queue = [...this.queue, ...fresh]
    this.queueAdded?.({
      tracks: fresh,
      message: `Radio de «${title ?? tracks[0]?.title ?? 'la última canción'}»: ${fresh.length} temas relacionados`
    })
    await this.open(start)
    return true
  }

  /** The radio (mix) of a song, seed first, for the renderer to load as the new playlist. */
  async startRadio(trackId?: string): Promise<Track[]> {
    const seed = trackId ?? this.currentId
    if (!seed) throw new Error('Reproducí o elegí una canción para armar su radio')
    const tracks = await this.catalog.radio(seed)
    if (!tracks.length) throw new Error('YouTube Music no devolvió una radio para esa canción')
    const at = tracks.findIndex((t) => t.id === seed)
    return at > 0 ? [tracks[at], ...tracks.slice(0, at), ...tracks.slice(at + 1)] : tracks
  }

  /** Warms up the radio while the last song of the list plays, so the switch has no gap. */
  private prefetchRadio(): void {
    const seed = this.currentId
    if (!seed || this.radioPrefetch?.seed === seed || !this.radioEnabled()) return
    if (this.order.hasNext(this.queue, seed, this.index)) return
    const tracks = this.catalog.radio(seed)
    this.radioPrefetch = { seed, tracks }
    tracks.catch(() => {
      if (this.radioPrefetch?.tracks === tracks) this.radioPrefetch = undefined
    })
  }

  watch(onState: (state: PlaybackState | null) => void): () => void {
    let busy = false
    const tick = async (): Promise<void> => {
      if (busy) return
      busy = true
      try {
        const status = await this.window.status()
        this.lastStatus = status
        if (!status || !status.videoId) {
          onState(null)
          return
        }
        if (this.loading && !status.ad) {
          const arrived = status.videoId === this.loading
          const other = status.videoId !== this.prevVideo && status.state !== YtState.Unstarted
          if (arrived || (other && Date.now() - this.loadingSince > 2500) || Date.now() - this.loadingSince > 8000) {
            if (!arrived) void this.window.expect(status.videoId).catch(() => undefined)
            this.loading = undefined
            this.playerId = status.videoId
          }
        }
        const idle = !this.loading && this.navigating === 0 && this.currentId !== undefined
        const mine = !this.loading && status.videoId === this.playerId
        if (idle && mine) this.prefetchRadio()
        const ended = (status.state === YtState.Ended || status.ended) && !status.ad
        if (idle && mine && ended && this.handledEnd !== this.currentId) {
          this.handledEnd = this.currentId
          void this.navigate(() => this.advance(true)).catch(() => undefined)
        } else if (idle && !mine && !status.ad) {
          // The page moved on by itself (its own autoplay): stop it and carry on with our queue.
          void this.window.pause().catch(() => undefined)
          if (this.handledEnd !== this.currentId) {
            this.handledEnd = this.currentId
            void this.navigate(() => this.advance(true)).catch(() => undefined)
          }
          // Don't show the page's own pick, even for a moment.
          return
        }

        const own = mine ? this.currentId : undefined
        const track = this.queue.find((t) => t.id === (own ?? status.videoId))
        onState({
          trackId: own ?? status.videoId,
          title: status.ad ? 'Anuncio' : (track?.title ?? status.title),
          artist: status.ad ? 'YouTube Music' : (track?.artist ?? status.author),
          album: status.ad ? undefined : track?.album,
          artworkUrl: thumbnail(status.videoId),
          durationMs: status.durationMs,
          positionMs: status.positionMs,
          isPlaying: status.state === YtState.Playing || status.state === YtState.Buffering,
          liked: this.liked.has(status.videoId)
        })
      } finally {
        busy = false
      }
    }
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => clearInterval(timer)
  }

  async dispose(): Promise<void> {
    this.offMedia()
    this.window.dispose()
  }
}
