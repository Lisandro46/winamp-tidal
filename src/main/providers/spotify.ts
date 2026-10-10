import type { PlayContext, PlaybackState, Playlist, Track } from '@shared/types'
import { OAuthSession } from '../auth/session'
import { ProviderError, type MusicProvider } from './provider'

const API = 'https://api.spotify.com/v1'
const CLIENT_ID = import.meta.env.MAIN_VITE_SPOTIFY_CLIENT_ID ?? ''
const POLL_MS = 1000
const POLL_BACKOFF_MS = 5000
const MAX_PAGES = 20
/** Spotify rejects very large `uris` bodies, so play a window around the chosen track. */
const URI_WINDOW = 100

interface SpotifyTrack {
  id: string
  uri: string
  type: string
  name: string
  duration_ms: number
  is_local?: boolean
  artists: { name: string }[]
  album?: { name: string; images?: { url: string }[] }
}
interface SpotifyPlaylist {
  id: string
  name: string
  uri: string
  collaborative: boolean
  owner: { id: string }
  // Renamed from `tracks` to `items` in the February 2026 API update.
  items?: { total: number }
  tracks?: { total: number }
}
interface Paging<T> {
  items: T[]
  next: string | null
}
interface PlayerState {
  is_playing: boolean
  progress_ms: number | null
  item: SpotifyTrack | null
  device: { name: string; volume_percent: number | null; supports_volume?: boolean }
}

const toTrack = (track: SpotifyTrack): Track => ({
  id: track.id,
  uri: track.uri,
  title: track.name,
  artist: track.artists.map((a) => a.name).join(', '),
  album: track.album?.name,
  durationMs: track.duration_ms
})

const isPlayableTrack = (track: SpotifyTrack | null | undefined): track is SpotifyTrack =>
  track != null && track.type === 'track' && !track.is_local && track.id != null

/** Spotify: library + remote control through the Web API (Spotify Connect). Needs Premium. */
export class SpotifyProvider implements MusicProvider {
  readonly id = 'spotify' as const
  readonly name = 'Spotify'
  readonly capabilities = { library: true, search: true, volume: true, seek: true }

  private session = new OAuthSession('spotify', () => ({
    authorizeUrl: 'https://accounts.spotify.com/authorize',
    tokenUrl: 'https://accounts.spotify.com/api/token',
    clientId: CLIENT_ID,
    scopes: [
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing',
      'playlist-read-private',
      'playlist-read-collaborative',
      'user-library-read'
    ],
    port: 8888
  }))
  private userId: string | undefined

  setupHint(): string | undefined {
    if (!CLIENT_ID) return 'Falta MAIN_VITE_SPOTIFY_CLIENT_ID en .env'
    return undefined
  }
  isConnected(): boolean {
    return this.session.isLoggedIn()
  }
  async connect(): Promise<void> {
    await this.session.login()
  }
  async disconnect(): Promise<void> {
    this.session.logout()
  }

  private api = <T>(path: string, init?: RequestInit): Promise<T | undefined> =>
    this.session.request<T>(path.startsWith('http') ? path : `${API}${path}`, init)

  private async getAll<T>(path: string): Promise<T[]> {
    const items: T[] = []
    let url: string | null = path
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const result: Paging<T> | undefined = await this.api<Paging<T>>(url)
      if (!result) break
      items.push(...result.items)
      url = result.next
    }
    return items
  }

  private async me(): Promise<string> {
    this.userId ??= (await this.api<{ id: string }>('/me'))?.id
    return this.userId ?? ''
  }

  // ---- Library -----------------------------------------------------------

  async getPlaylists(): Promise<Playlist[]> {
    const [userId, playlists] = await Promise.all([
      this.me(),
      this.getAll<SpotifyPlaylist | null>('/me/playlists?limit=50')
    ])
    return playlists
      .filter((p): p is SpotifyPlaylist => p != null)
      .map((p) => ({
        id: p.id,
        name: p.name,
        uri: p.uri,
        trackCount: (p.items ?? p.tracks)?.total,
        // Since Feb 2026 Spotify only lists items of playlists you own or collaborate on.
        tracksListable: p.owner.id === userId || p.collaborative
      }))
  }

  async getPlaylistTracks(playlistId: string): Promise<Track[]> {
    const entries = await this.getAll<{ item?: SpotifyTrack | null; track?: SpotifyTrack | null }>(
      `/playlists/${playlistId}/items?limit=50`
    )
    return entries.map((e) => e.item ?? e.track).filter(isPlayableTrack).map(toTrack)
  }

  async getLikedTracks(): Promise<Track[]> {
    const entries = await this.getAll<{ track: SpotifyTrack }>('/me/tracks?limit=50')
    return entries.map((e) => e.track).filter(isPlayableTrack).map(toTrack)
  }

  async search(query: string): Promise<Track[]> {
    // Development-mode apps get at most 10 results per request.
    const pages = await Promise.all(
      [0, 10, 20].map((offset) =>
        this.api<{ tracks: Paging<SpotifyTrack> }>(
          `/search?type=track&limit=10&offset=${offset}&q=${encodeURIComponent(query)}`
        )
      )
    )
    return pages.flatMap((p) => p?.tracks.items ?? []).filter(isPlayableTrack).map(toTrack)
  }

  // ---- Playback ----------------------------------------------------------

  /** Player commands; when no device is active, wake the first available one. */
  private async player(path: string, method: string, body?: unknown): Promise<void> {
    const init = { method, body: body ? JSON.stringify(body) : undefined }
    try {
      await this.api(`/me/player${path}`, init)
    } catch (error) {
      if (!String((error as Error).message).startsWith('404')) throw error
      const devices = await this.api<{ devices: { id: string; is_active: boolean }[] }>('/me/player/devices')
      const device = devices?.devices[0]
      if (!device) {
        throw new ProviderError('No hay ningún dispositivo Spotify abierto. Abrí Spotify en la PC o el celular.')
      }
      const separator = path.includes('?') ? '&' : '?'
      await this.api(`/me/player${path}${separator}device_id=${device.id}`, init)
    }
  }

  async playTrack({ playlist, tracks, index }: PlayContext): Promise<void> {
    const track = tracks[index]
    if (!track) return
    if (playlist?.uri) {
      return this.player('/play', 'PUT', { context_uri: playlist.uri, offset: { uri: track.uri } })
    }
    const start = Math.max(0, index - Math.floor(URI_WINDOW / 5))
    const uris = tracks.slice(start, start + URI_WINDOW).map((t) => t.uri)
    return this.player('/play', 'PUT', { uris, offset: { position: index - start } })
  }

  playPlaylist = (playlist: Playlist): Promise<void> =>
    this.player('/play', 'PUT', { context_uri: playlist.uri })
  resume = (): Promise<void> => this.player('/play', 'PUT')
  pause = (): Promise<void> => this.player('/pause', 'PUT')
  next = (): Promise<void> => this.player('/next', 'POST')
  previous = (): Promise<void> => this.player('/previous', 'POST')
  seek = (positionMs: number): Promise<void> =>
    this.player(`/seek?position_ms=${Math.round(positionMs)}`, 'PUT')
  setVolume = (volume: number): Promise<void> =>
    this.player(`/volume?volume_percent=${Math.round(volume)}`, 'PUT')

  watch(onState: (state: PlaybackState | null) => void): () => void {
    let stopped = false
    let timer: NodeJS.Timeout | undefined
    const poll = async (): Promise<void> => {
      let delay = POLL_MS
      try {
        const state = await this.api<PlayerState>('/me/player')
        const item = state?.item
        onState(
          state && item
            ? {
                provider: this.id,
                trackId: item.id,
                title: item.name,
                artist: item.artists.map((a) => a.name).join(', '),
                album: item.album?.name,
                artworkUrl: item.album?.images?.[0]?.url,
                durationMs: item.duration_ms,
                positionMs: state.progress_ms ?? 0,
                isPlaying: state.is_playing,
                volume: state.device.supports_volume === false ? null : state.device.volume_percent,
                device: state.device.name
              }
            : null
        )
      } catch (error) {
        console.warn('[spotify] poll failed', (error as Error).message)
        delay = POLL_BACKOFF_MS
      }
      if (!stopped) timer = setTimeout(poll, delay)
    }
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }
}
