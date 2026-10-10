// Types shared by the main process, preload and renderer.

export interface Track {
  id: string
  title: string
  artist: string
  album?: string
  durationMs: number
}

export type CollectionKind = 'playlist' | 'album' | 'artist' | 'mix'

/** Anything that resolves to a list of tracks: playlist, album, artist top tracks or mix. */
export interface Collection {
  kind: CollectionKind
  id: string
  name: string
  subtitle?: string
  trackCount?: number
  artworkUrl?: string
}

export interface SearchResults {
  tracks: Track[]
  albums: Collection[]
  artists: Collection[]
  playlists: Collection[]
}

/** The list a track was started from, so the app can keep going through it. */
export interface PlayContext {
  tracks: Track[]
  index: number
}

export interface PlaybackState {
  /** TIDAL track id when known (matched in the queue or resolved through the API). */
  trackId?: string
  title: string
  artist: string
  album?: string
  artworkUrl?: string
  durationMs: number
  positionMs: number
  isPlaying: boolean
  liked?: boolean
}

export interface SystemVolume {
  volume: number
  muted: boolean
  device: string
}

/** Webamp's equalizer: values are 0-100 with 50 = 0 dB (±12 dB range). */
export interface EqState {
  on: boolean
  preamp: number
  bands: number[]
}

export interface EqStatus {
  installed: boolean
  configDir?: string
  error?: string
}

export interface AuthInfo {
  configured: boolean
  connected: boolean
  hint?: string
}

export interface AppSettings {
  skinUrl?: string
  eq?: EqState
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Monitor work areas in window coordinates (the window spans all monitors). */
export interface DesktopLayout {
  primary: Rect
  displays: Rect[]
}

export interface PcmChunk {
  rate: number
  /** Base64 mono signed 16-bit PCM. */
  data: string
}

/** API exposed by the preload script as `window.remote`. */
export interface RemoteApi {
  getAuth(): Promise<AuthInfo>
  connect(): Promise<AuthInfo>
  disconnect(): Promise<AuthInfo>
  getSettings(): Promise<AppSettings>
  setSkin(url: string | undefined): Promise<void>

  getLikedTracks(): Promise<Track[]>
  getPlaylists(): Promise<Collection[]>
  getMixes(): Promise<Collection[]>
  getAlbums(): Promise<Collection[]>
  getArtists(): Promise<Collection[]>
  getTracks(collection: Collection): Promise<Track[]>
  search(query: string): Promise<SearchResults>
  setLiked(trackId: string, liked: boolean): Promise<void>
  getLikedIds(): Promise<string[]>

  playTrack(context: PlayContext): Promise<void>
  resume(): Promise<void>
  pause(): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
  seek(positionMs: number): Promise<void>

  setVolume(volume: number): Promise<void>
  getEq(): Promise<EqStatus>
  setEq(state: EqState): Promise<EqStatus>
  /** Call once all listeners are registered; starts state, volume and audio updates. */
  ready(): Promise<void>

  onState(callback: (state: PlaybackState | null) => void): () => void
  onVolume(callback: (volume: SystemVolume) => void): () => void
  onPcm(callback: (chunk: PcmChunk) => void): () => void
  onLiked(callback: (ids: string[]) => void): () => void
  onError(callback: (message: string) => void): () => void

  windowControl(action: 'minimize' | 'close'): void
  /** Whether the pointer is over UI (clicks handled) or empty space (clicks pass through). */
  setInteractive(interactive: boolean): void
  getLayout(): Promise<DesktopLayout>
  onLayout(callback: (layout: DesktopLayout) => void): () => void
}
