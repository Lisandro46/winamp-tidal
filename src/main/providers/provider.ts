import type {
  PlayContext,
  PlaybackState,
  Playlist,
  ProviderCapabilities,
  ProviderId,
  Track
} from '@shared/types'

export interface MusicProvider {
  readonly id: ProviderId
  readonly name: string
  readonly capabilities: ProviderCapabilities

  /** Why the provider cannot be used yet, or undefined when it is configured. */
  setupHint(): string | undefined
  isConnected(): boolean
  connect(): Promise<void>
  disconnect(): Promise<void>

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

  /** Start pushing state updates; returns a function that stops them. */
  watch(onState: (state: PlaybackState | null) => void): () => void
}

export class ProviderError extends Error {}
