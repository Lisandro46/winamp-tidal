import type { Collection, PlayContext, PlaybackState, SearchResults, Track } from '@shared/types'
import type { MusicProvider } from '../types'
import { YtCatalog } from './catalog'
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
  /** The video we asked for, until the player reports it. */
  private loading: string | undefined

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
    await this.window.login()
    await this.refreshCookie()
  }
  async logout(): Promise<void> {
    await this.window.logout()
    await this.refreshCookie()
  }
  async ensureUser(): Promise<void> {
    await this.refreshCookie()
    if (!this.connected) throw new Error('Iniciá sesión en YouTube Music para ver tu biblioteca')
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
    this.liked = new Set(this.connected ? (await this.catalog.likedTracks()).map((t) => t.id) : [])
    this.onLikedChange([...this.liked])
  }
  likedIds(): string[] {
    return [...this.liked]
  }
  async setLiked(trackId: string, liked: boolean): Promise<void> {
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
    this.window.dispose()
  }
}
