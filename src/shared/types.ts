// Types shared by the main process, preload and renderer.

import type { MuseumSkin } from './skins'

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

export type ProviderId = 'tidal' | 'ytmusic'

export const PROVIDER_NAMES: Record<ProviderId, string> = { tidal: 'TIDAL', ytmusic: 'YouTube Music' }

export interface ProviderCapabilities {
  /** Needs the user's own developer app for search (TIDAL's catalog mode). */
  credentials: boolean
  /** Has personal mixes in the library. */
  mixes: boolean
  /** Plays through another app that must be open (the TIDAL desktop app). */
  externalApp: boolean
}

export interface AuthInfo {
  provider: ProviderId
  capabilities: ProviderCapabilities
  configured: boolean
  connected: boolean
  /** Search and catalog browsing work (user login, or the app's client credentials). */
  catalog: boolean
  hint?: string
}

/** A YouTube account (channel) of the signed-in Google login. */
export interface YtAccount {
  id: string
  name: string
  handle?: string
  email?: string
  photoUrl?: string
}

export interface YtAccounts {
  current?: YtAccount
  accounts: YtAccount[]
}

/** One of the user's own playlists, as offered by "Agregar a playlist…". */
export interface PlaylistChoice {
  id: string
  name: string
}

export interface AppSettings {
  /** YouTube Music: the chosen account (channel) id; unset follows the one active on music.youtube.com. */
  ytAccount?: string
  /** The music service the Winamp drives. */
  provider?: ProviderId
  skinUrl?: string
  eq?: EqState
  /** Zoom factor for the whole UI. */
  scale?: number
  /** The first-run setup was answered (service, and for TIDAL catalog or remote-only). */
  setupDone?: boolean
  /** YouTube Music: when the list ends, keep going with a radio of the last song (default on). */
  autoRadio?: boolean
}

/** Winamp's SHUF and REP buttons; the app's queue (not the service) decides the order. */
export interface PlayMode {
  shuffle: boolean
  /** Repeat the whole list when it ends. */
  repeat: boolean
}

/** Tracks the app appended to the queue by itself (the radio after the list ended). */
export interface QueueAdd {
  tracks: Track[]
  message: string
}

/** The user's own TIDAL developer app (developer.tidal.com). */
export interface TidalCredentials {
  clientId: string
  clientSecret: string
}

export interface CredentialsInfo {
  clientId: string
  hasSecret: boolean
  /** Saved from the setup dialog, baked into the build from .env, or none. */
  source: 'saved' | 'build' | 'none'
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
  scale: number
}

export interface PcmChunk {
  rate: number
  /** Base64 mono signed 16-bit PCM. */
  data: string
}

/** API exposed by the preload script as `window.remote`. */
export interface RemoteApi {
  /** `process.platform` of the host; TIDAL (SMTC helper) only works on 'win32'. */
  readonly platform: string
  getAuth(): Promise<AuthInfo>
  connect(): Promise<AuthInfo>
  /** Aborts a browser sign-in that is still waiting (macOS). */
  cancelLogin(): Promise<void>
  /** Progress text while signing in through the user's browser (macOS). */
  onLoginStatus(callback: (text: string) => void): () => void
  disconnect(): Promise<AuthInfo>
  getCredentials(): Promise<CredentialsInfo>
  /** Checks and saves the user's TIDAL app, or `null` for remote-only use. Ends the first-run setup. */
  setCredentials(credentials: TidalCredentials | null): Promise<AuthInfo>
  getSettings(): Promise<AppSettings>
  /** Switches the music service; the Winamp playlist should be cleared. */
  setProvider(provider: ProviderId): Promise<AuthInfo>
  /** YouTube Music sign-in with the cookies of the user's own browser (passkey-only accounts). */
  importYouTubeSession(cookies: string): Promise<AuthInfo>
  /** YouTube Music: the accounts (channels) of the signed-in login and the one in use. */
  getAccounts(): Promise<YtAccounts>
  /** YouTube Music: switches the account (channel) used for the library and playback. */
  selectAccount(id: string): Promise<YtAccounts>
  setSkin(url: string | undefined): Promise<void>
  /** Classic skins from the Winamp Skin Museum. */
  searchSkins(query: string): Promise<MuseumSkin[]>

  getLikedTracks(): Promise<Track[]>
  getPlaylists(): Promise<Collection[]>
  getMixes(): Promise<Collection[]>
  getAlbums(): Promise<Collection[]>
  getArtists(): Promise<Collection[]>
  getTracks(collection: Collection): Promise<Track[]>
  search(query: string): Promise<SearchResults>
  setLiked(trackId: string, liked: boolean): Promise<void>
  getLikedIds(): Promise<string[]>
  /** Keys ("album:<id>") of the albums and playlists saved in the user's library (artists: see getFollowing). */
  getSaved(): Promise<string[]>
  /** Which of these artists (ids) the user follows; checked per artist, so ask only for those on screen. */
  getFollowing(artistIds: string[]): Promise<string[]>
  /** Saves/removes an album or playlist, or follows/unfollows an artist. */
  setSaved(collection: Collection, saved: boolean): Promise<void>
  /** The user's own playlists that tracks can be added to. */
  getEditablePlaylists(trackIds: string[]): Promise<PlaylistChoice[]>
  /** Resolves to how many of the tracks were new to the playlist (the others were already in it). */
  addToPlaylist(playlistId: string, trackIds: string[]): Promise<number>
  createPlaylist(name: string, trackIds: string[]): Promise<PlaylistChoice>

  playTrack(context: PlayContext): Promise<void>
  /** Keeps the app's queue in sync with the Winamp playlist. */
  setQueue(tracks: Track[]): Promise<void>
  /** Shuffle / repeat as set on the Winamp buttons. */
  setPlayMode(mode: PlayMode): Promise<void>
  /** YouTube Music radio (mix) of a song; the current one when no id is given. The seed comes first. */
  startRadio(trackId?: string): Promise<Track[]>
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
  /** Milkdrop full screen on the monitor under `point` (main window CSS pixels). */
  openVisualizer(point: { x: number; y: number }, preset?: string): Promise<void>

  onState(callback: (state: PlaybackState | null) => void): () => void
  onVolume(callback: (volume: SystemVolume) => void): () => void
  onPcm(callback: (chunk: PcmChunk) => void): () => void
  onLiked(callback: (ids: string[]) => void): () => void
  onError(callback: (message: string) => void): () => void
  /** The app added tracks to the queue on its own (radio); append them to the Winamp playlist. */
  onQueueAdd(callback: (added: QueueAdd) => void): () => void
  onProvider(callback: (auth: AuthInfo) => void): () => void

  windowControl(action: 'minimize' | 'close'): void
  /** Whether the pointer is over UI (clicks handled) or empty space (clicks pass through). */
  setInteractive(interactive: boolean): void
  /** macOS: resize the app window to wrap the visible panels (CSS pixels). */
  /** macOS: the page asks the main process to move the window along with the pointer. */
  dragWindow(action: 'start' | 'end'): void
  fitWindow(width: number, height: number): void
  scaleWindow(direction: 'in' | 'out' | 'reset'): void
  getLayout(): Promise<DesktopLayout>
  onLayout(callback: (layout: DesktopLayout) => void): () => void
}
