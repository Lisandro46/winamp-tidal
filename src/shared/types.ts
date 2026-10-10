// Types shared by the main process, preload and renderer.

export type ProviderId = 'spotify' | 'tidal' | 'system'

export interface Track {
  id: string
  /** Provider URI used to start playback (spotify:track:…, tidal track id, …). */
  uri: string
  title: string
  artist: string
  album?: string
  durationMs: number
}

export interface Playlist {
  id: string
  name: string
  uri?: string
  trackCount?: number
  /** False when the provider refuses to list the tracks (e.g. followed Spotify playlists). */
  tracksListable: boolean
}

/** Where a track was started from, so the remote player can keep going through it. */
export interface PlayContext {
  playlist?: Playlist
  /** Ordered tracks of the list the user picked from (liked songs, search results, …). */
  tracks: Track[]
  index: number
}

export interface PlaybackState {
  provider: ProviderId
  /** Matches Track.id when the remote is playing something we listed. */
  trackId?: string
  title: string
  artist: string
  album?: string
  artworkUrl?: string
  durationMs: number
  positionMs: number
  isPlaying: boolean
  /** 0-100, or null when the provider cannot report/change volume. */
  volume: number | null
  /** Name of the device/app actually producing sound. */
  device?: string
}

export interface ProviderCapabilities {
  library: boolean
  search: boolean
  volume: boolean
  seek: boolean
}

export interface ProviderInfo {
  id: ProviderId
  name: string
  connected: boolean
  capabilities: ProviderCapabilities
  /** Human-readable reason the provider cannot be used yet (missing client id, …). */
  setupHint?: string
}

export interface AppSettings {
  provider: ProviderId
  skinUrl?: string
}

/** API exposed by the preload script as `window.remote`. */
export interface RemoteApi {
  listProviders(): Promise<ProviderInfo[]>
  getSettings(): Promise<AppSettings>
  selectProvider(id: ProviderId): Promise<ProviderInfo>
  connect(id: ProviderId): Promise<ProviderInfo>
  disconnect(id: ProviderId): Promise<ProviderInfo>
  setSkin(url: string | undefined): Promise<void>

  getPlaylists(): Promise<Playlist[]>
  getPlaylistTracks(playlistId: string): Promise<Track[]>
  getLikedTracks(): Promise<Track[]>
  search(query: string): Promise<Track[]>

  playTrack(context: PlayContext): Promise<void>
  playPlaylist(playlist: Playlist): Promise<void>
  resume(): Promise<void>
  pause(): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
  seek(positionMs: number): Promise<void>
  setVolume(volume: number): Promise<void>

  onState(callback: (state: PlaybackState | null) => void): () => void
  onError(callback: (message: string) => void): () => void
  onProviders(callback: (providers: ProviderInfo[]) => void): () => void

  windowControl(action: 'minimize' | 'close'): void
}
