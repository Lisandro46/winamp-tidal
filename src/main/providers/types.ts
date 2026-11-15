import type {
  Collection,
  PlayContext,
  PlayMode,
  PlaybackState,
  PlaylistChoice,
  ProviderCapabilities,
  ProviderId,
  QueueAdd,
  SearchResults,
  Track,
  YtAccounts
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
  /** Services with several accounts behind one login (YouTube Music). */
  accountsInfo?(): Promise<YtAccounts>
  selectAccount?(id: string): Promise<YtAccounts>

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

  // ---- Library edits (optional: only some services offer them) ---------------------
  /** Keys of the albums, artists and playlists saved in the user's library. */
  savedKeys?(): Promise<string[]>
  setSaved?(collection: Collection, saved: boolean): Promise<void>
  /** Which of these artists the user follows. */
  followingArtists?(ids: string[]): Promise<string[]>
  editablePlaylists?(trackIds: string[]): Promise<PlaylistChoice[]>
  /** Resolves to how many of the tracks were new to the playlist. */
  addToPlaylist?(playlistId: string, trackIds: string[]): Promise<number>
  createPlaylist?(name: string, trackIds: string[]): Promise<PlaylistChoice>

  // ---- Playback ----------------------------------------------------------------
  playTrack(context: PlayContext): Promise<void>
  /** The Winamp playlist changed (tracks added, removed or reordered). */
  setQueue(tracks: Track[]): void
  /** Shuffle / repeat buttons (YouTube Music; TIDAL decides its own order). */
  setPlayMode?(mode: PlayMode): void
  /** A radio (mix) built from a song, the current one when no id is given. */
  startRadio?(trackId?: string): Promise<Track[]>
  /** Set by the host: the provider appended tracks to its queue by itself (radio). */
  queueAdded?: (added: QueueAdd) => void
  resume(): Promise<void>
  pause(): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
  seek(positionMs: number): Promise<void>
  watch(onState: (state: PlaybackState | null) => void): () => void

  /** Switching to another provider: stop playing and release resources. */
  dispose(): Promise<void>
}
