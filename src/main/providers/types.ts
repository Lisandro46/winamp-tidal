import type {
  Collection,
  PlayContext,
  PlaybackState,
  ProviderCapabilities,
  ProviderId,
  SearchResults,
  Track
} from '@shared/types'

/**
 * A music service the Winamp drives: its catalog and library, plus playback.
 * The renderer only sees the generic `RemoteApi`; `ipc.ts` routes it to the
 * provider the user picked.
 */
export interface MusicProvider {
  readonly id: ProviderId
  readonly name: string
  readonly capabilities: ProviderCapabilities

  // ---- Auth ------------------------------------------------------------------
  /** Has whatever it needs to work beyond the basics (e.g. TIDAL's catalog app). */
  readonly configured: boolean
  /** A user is logged in: favorites, playlists and the rest of the library work. */
  readonly connected: boolean
  /** Search and browsing work. */
  readonly catalogAvailable: boolean
  login(): Promise<void>
  logout(): Promise<void>
  ensureUser(): Promise<void>
  ensureCatalog(): Promise<void>

  // ---- Catalog and library -----------------------------------------------------
  search(query: string): Promise<SearchResults>
  collectionTracks(collection: Collection): Promise<Track[]>
  likedTracks(): Promise<Track[]>
  userPlaylists(): Promise<Collection[]>
  userAlbums(): Promise<Collection[]>
  userArtists(): Promise<Collection[]>
  mixes(): Promise<Collection[]>

  // ---- Favorites ---------------------------------------------------------------
  loadLiked(): Promise<void>
  likedIds(): string[]
  setLiked(trackId: string, liked: boolean): Promise<void>

  // ---- Playback ----------------------------------------------------------------
  playTrack(context: PlayContext): Promise<void>
  /** The Winamp playlist changed (tracks added, removed or reordered). */
  setQueue(tracks: Track[]): void
  resume(): Promise<void>
  pause(): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
  seek(positionMs: number): Promise<void>
  watch(onState: (state: PlaybackState | null) => void): () => void

  /** Switching to another provider: stop playing and release resources. */
  dispose(): Promise<void>
}
