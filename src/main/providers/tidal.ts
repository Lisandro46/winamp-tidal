import { shell } from 'electron'
import type { PlayContext, PlaybackState, Playlist, Track } from '@shared/types'
import { OAuthSession } from '../auth/session'
import { smtc, type SmtcSession } from '../smtc/helperClient'
import { ProviderError, type MusicProvider } from './provider'
import { watchSmtc } from './system'

const API = 'https://openapi.tidal.com/v2'
const MAX_PAGES = 10
const CLIENT_ID = import.meta.env.MAIN_VITE_TIDAL_CLIENT_ID ?? ''

interface Resource {
  id: string
  type: string
  attributes?: Record<string, unknown>
  relationships?: Record<string, { data?: { id: string; type: string }[] | { id: string; type: string } }>
}
interface Document {
  data: Resource[] | Resource
  included?: Resource[]
  links?: { next?: string }
}

/** "PT3M25S" → 205000 */
export function isoDurationToMs(duration: unknown): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(duration ?? ''))
  if (!match) return 0
  const [, h = '0', m = '0', s = '0'] = match
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000
}

const normalize = (text: string): string => text.toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, ' ').trim()

/** SMTC only exposes title/artist, so tracks are matched by (normalized) title. */
const sameTrack = (session: SmtcSession, track: Track): boolean =>
  normalize(session.title) === normalize(track.title) ||
  normalize(session.title).startsWith(normalize(track.title))

/**
 * TIDAL: library through the official API v2; playback through the TIDAL desktop
 * app (tidal:// deep links + Windows media controls), since TIDAL's remote playback
 * API is internal-only.
 */
export class TidalProvider implements MusicProvider {
  readonly id = 'tidal' as const
  readonly name = 'TIDAL'
  readonly capabilities = { library: true, search: true, volume: false, seek: true }

  private session = new OAuthSession('tidal', () => ({
    authorizeUrl: 'https://login.tidal.com/authorize',
    tokenUrl: 'https://auth.tidal.com/v1/oauth2/token',
    clientId: CLIENT_ID,
    scopes: ['user.read', 'collection.read', 'playlists.read', 'search.read'],
    port: 8889
  }))
  private countryCode: string | undefined

  /** The list the user started playing from; the app drives TIDAL through it. */
  private queue: Track[] = []
  private index = -1
  private lastSession: SmtcSession | undefined

  setupHint(): string | undefined {
    if (!CLIENT_ID) return 'Falta MAIN_VITE_TIDAL_CLIENT_ID en .env'
    return undefined
  }
  isConnected(): boolean {
    return this.session.isLoggedIn()
  }
  async connect(): Promise<void> {
    await this.session.login()
    smtc.start()
  }
  async disconnect(): Promise<void> {
    this.session.logout()
  }

  // ---- API helpers -------------------------------------------------------

  private url(path: string, params: Record<string, string | string[]> = {}): string {
    const url = new URL(path.startsWith('http') ? path : `${API}${path}`)
    for (const [key, value] of Object.entries(params)) {
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, item)
    }
    return url.toString()
  }

  private get = (url: string): Promise<Document | undefined> =>
    this.session.request<Document>(url, { headers: { Accept: 'application/vnd.api+json' } })

  private async country(): Promise<string> {
    if (!this.countryCode) {
      const me = await this.get(this.url('/users/me'))
      const user = me?.data as Resource | undefined
      this.countryCode = String(user?.attributes?.country ?? 'US')
    }
    return this.countryCode
  }

  /** Follows JSON:API `links.next` and returns all primary data plus included resources. */
  private async getAll(firstUrl: string): Promise<{ data: Resource[]; included: Resource[] }> {
    const data: Resource[] = []
    const included: Resource[] = []
    let url: string | undefined = firstUrl
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const doc = await this.get(url)
      if (!doc) break
      data.push(...(Array.isArray(doc.data) ? doc.data : [doc.data]))
      included.push(...(doc.included ?? []))
      url = doc.links?.next ? this.url(doc.links.next) : undefined
    }
    return { data, included }
  }

  /** Loads full track objects (title, artists, album) for track ids, 20 per request. */
  private async hydrateTracks(ids: string[]): Promise<Track[]> {
    const countryCode = await this.country()
    const byId = new Map<string, Track>()
    for (let i = 0; i < ids.length; i += 20) {
      const doc = await this.get(
        this.url('/tracks', {
          'filter[id]': ids.slice(i, i + 20),
          include: ['artists', 'albums'],
          countryCode
        })
      )
      if (!doc) continue
      const included = new Map((doc.included ?? []).map((r) => [`${r.type}:${r.id}`, r]))
      const names = (rel: Resource['relationships'], key: string, attr: string): string[] => {
        const linkage = rel?.[key]?.data
        return (Array.isArray(linkage) ? linkage : linkage ? [linkage] : [])
          .map((l) => included.get(`${l.type}:${l.id}`)?.attributes?.[attr])
          .filter((n): n is string => typeof n === 'string')
      }
      for (const track of Array.isArray(doc.data) ? doc.data : [doc.data]) {
        const version = track.attributes?.version ? ` (${track.attributes.version})` : ''
        byId.set(track.id, {
          id: track.id,
          uri: track.id,
          title: `${track.attributes?.title ?? 'Unknown'}${version}`,
          artist: names(track.relationships, 'artists', 'name').join(', '),
          album: names(track.relationships, 'albums', 'title')[0],
          durationMs: isoDurationToMs(track.attributes?.duration)
        })
      }
    }
    // Keep the original order; drop ids that are unavailable in this country.
    return ids.map((id) => byId.get(id)).filter((t): t is Track => t != null)
  }

  private trackIds = (data: Resource[]): string[] => data.filter((r) => r.type === 'tracks').map((r) => r.id)

  // ---- Library -----------------------------------------------------------

  async getPlaylists(): Promise<Playlist[]> {
    const countryCode = await this.country()
    const [favorites, own] = await Promise.all([
      this.getAll(
        this.url('/userCollectionPlaylists/me/relationships/items', {
          include: 'items',
          collectionView: 'FLAT'
        })
      ),
      this.getAll(this.url('/playlists', { 'filter[owners.id]': 'me', countryCode }))
    ])
    const playlists = new Map<string, Playlist>()
    const add = (resource: Resource | undefined): void => {
      if (!resource || resource.type !== 'playlists' || playlists.has(resource.id)) return
      playlists.set(resource.id, {
        id: resource.id,
        name: String(resource.attributes?.name ?? 'Playlist'),
        uri: resource.id,
        trackCount: Number(resource.attributes?.numberOfItems ?? 0) || undefined,
        tracksListable: true
      })
    }
    own.data.forEach(add)
    const included = new Map(favorites.included.map((r) => [r.id, r]))
    favorites.data.forEach((linkage) => add(included.get(linkage.id)))
    return [...playlists.values()]
  }

  async getPlaylistTracks(playlistId: string): Promise<Track[]> {
    const countryCode = await this.country()
    const { data } = await this.getAll(
      this.url(`/playlists/${encodeURIComponent(playlistId)}/relationships/items`, { countryCode })
    )
    return this.hydrateTracks(this.trackIds(data))
  }

  async getLikedTracks(): Promise<Track[]> {
    const { data } = await this.getAll(
      this.url('/userCollectionTracks/me/relationships/items', { sort: '-addedAt' })
    )
    return this.hydrateTracks(this.trackIds(data))
  }

  async search(query: string): Promise<Track[]> {
    const countryCode = await this.country()
    const doc = await this.get(
      this.url(`/searchResults/${encodeURIComponent(query)}/relationships/tracks`, { countryCode })
    )
    const data = doc ? (Array.isArray(doc.data) ? doc.data : [doc.data]) : []
    return this.hydrateTracks(this.trackIds(data))
  }

  // ---- Playback ----------------------------------------------------------

  private async open(index: number): Promise<void> {
    const track = this.queue[index]
    if (!track) return
    this.index = index
    await shell.openExternal(`tidal://track/${track.id}`)
    // The deep link focuses the track; make sure it actually starts playing.
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((r) => setTimeout(r, 500))
      const session = smtc.session('tidal')
      if (session && sameTrack(session, track)) {
        if (!session.isPlaying) await smtc.send('play', 'tidal').catch(() => undefined)
        return
      }
    }
  }

  async playTrack(context: PlayContext): Promise<void> {
    this.queue = context.tracks
    await this.open(context.index)
  }

  async playPlaylist(playlist: Playlist): Promise<void> {
    const tracks = await this.getPlaylistTracks(playlist.id)
    if (!tracks.length) throw new ProviderError('La playlist está vacía')
    await this.playTrack({ playlist, tracks, index: 0 })
  }

  resume = (): Promise<void> => smtc.send('play', 'tidal')
  pause = (): Promise<void> => smtc.send('pause', 'tidal')
  seek = (positionMs: number): Promise<void> => smtc.send('seek', 'tidal', { positionMs })
  async setVolume(): Promise<void> {}

  async next(): Promise<void> {
    if (this.index >= 0 && this.index + 1 < this.queue.length) return this.open(this.index + 1)
    return smtc.send('next', 'tidal')
  }

  async previous(): Promise<void> {
    // Like Winamp/TIDAL: restart the song unless we are at its very beginning.
    if ((this.lastSession?.positionMs ?? 0) > 3000) return smtc.send('seek', 'tidal', { positionMs: 0 })
    if (this.index > 0) return this.open(this.index - 1)
    return smtc.send('previous', 'tidal')
  }

  watch(onState: (state: PlaybackState | null) => void): () => void {
    return watchSmtc(this.id, 'tidal', (state, session) => {
      const previous = this.lastSession
      this.lastSession = session
      const current = this.queue[this.index]

      // TIDAL keeps playing its own radio after a deep-linked track ends, so we
      // advance through our queue when the track we started finishes.
      if (current && previous && session && sameTrack(previous, current) && !sameTrack(session, current)) {
        const nearEnd = previous.durationMs > 0 && previous.positionMs >= previous.durationMs - 5000
        if (nearEnd && this.index + 1 < this.queue.length) void this.open(this.index + 1)
        else if (!nearEnd) this.index = this.queue.findIndex((t) => sameTrack(session, t))
      }

      if (state && session) {
        state.trackId = this.queue.find((t) => sameTrack(session, t))?.id
      }
      onState(state)
    })
  }
}
