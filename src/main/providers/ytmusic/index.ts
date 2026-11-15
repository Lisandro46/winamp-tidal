import type { Collection, PlayContext, PlaybackState, SearchResults, Track, YtAccount, YtAccounts } from '@shared/types'
import { signInWithBrowser } from '../../auth/browserCookies'
import { settingsStore } from '../../auth/store'
import { pageAudio } from '../../platform/pageAudio'
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

  private async open(index: number): Promise<void> {
    const track = this.queue[index]
    if (!track) return
    this.index = index
    this.loading = track.id
    await this.window.load(track.id)
  }

  async playTrack(context: PlayContext): Promise<void> {
    this.queue = context.tracks
    await this.open(context.index)
  }

  setQueue(tracks: Track[]): void {
    const current = this.queue[this.index]
    this.queue = tracks
    this.index = current ? tracks.findIndex((t) => t.id === current.id) : -1
  }

  async resume(): Promise<void> {
    // Nothing loaded yet (e.g. right after start): play the selected queue entry.
    if (!this.lastStatus?.videoId && this.queue.length) return this.open(Math.max(0, this.index))
    await this.window.play()
  }
  pause(): Promise<void> {
    return this.window.pause()
  }
  async next(): Promise<void> {
    if (this.index + 1 < this.queue.length) await this.open(this.index + 1)
  }
  async previous(): Promise<void> {
    // Like Winamp: restart the song unless we are at its very beginning.
    if ((this.lastStatus?.positionMs ?? 0) > 3000 || this.index <= 0) return this.window.seek(0)
    await this.open(this.index - 1)
  }
  seek(positionMs: number): Promise<void> {
    return this.window.seek(positionMs)
  }

  watch(onState: (state: PlaybackState | null) => void): () => void {
    let busy = false
    const tick = async (): Promise<void> => {
      if (busy) return
      busy = true
      try {
        const status = await this.window.status()
        const previous = this.lastStatus
        this.lastStatus = status
        if (!status || !status.videoId) {
          onState(null)
          return
        }
        if (status.videoId === this.loading && !status.ad) this.loading = undefined
        const current = this.queue[this.index]
        // Ended, or YouTube Music moved on to its own "up next": continue our queue.
        const ended = status.state === YtState.Ended && !status.ad
        const drifted =
          !this.loading &&
          current &&
          previous?.videoId === current.id &&
          status.videoId !== current.id &&
          !status.ad &&
          previous.durationMs > 0 &&
          previous.positionMs >= previous.durationMs - 5000
        if (!this.loading && current && (ended || drifted)) {
          if (this.index + 1 < this.queue.length) void this.open(this.index + 1).catch(() => undefined)
          else if (drifted) void this.window.pause().catch(() => undefined)
        }

        const track = this.queue.find((t) => t.id === status.videoId)
        onState({
          trackId: status.videoId,
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
