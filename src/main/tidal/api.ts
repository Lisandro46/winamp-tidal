import type { Collection, SearchResults, Track } from '@shared/types'
import { ApiError, OAuthSession } from '../auth/session'

const API = 'https://openapi.tidal.com/v2'
const CLIENT_ID = import.meta.env.MAIN_VITE_TIDAL_CLIENT_ID ?? ''
const MAX_PAGES = 15
/** TIDAL allows up to 20 ids per filtered request. */
const BATCH = 20
/** Preferred cover size for lists and the now-playing card. */
const ARTWORK_SIZE = 320

interface Linkage {
  id: string
  type: string
}
interface Resource extends Linkage {
  attributes?: Record<string, unknown>
  relationships?: Record<string, { data?: Linkage[] | Linkage }>
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

const asArray = <T>(value: T | T[] | undefined): T[] => (Array.isArray(value) ? value : value ? [value] : [])

/** Index of included resources with helpers to follow relationships. */
class Included {
  private byKey: Map<string, Resource>

  constructor(resources: Resource[]) {
    this.byKey = new Map(resources.map((r) => [`${r.type}:${r.id}`, r]))
  }

  related(resource: Resource, relationship: string): Resource[] {
    return asArray(resource.relationships?.[relationship]?.data)
      .map((l) => this.byKey.get(`${l.type}:${l.id}`))
      .filter((r): r is Resource => r != null)
  }

  names(resource: Resource, relationship: string, attribute: string): string[] {
    return this.related(resource, relationship)
      .map((r) => r.attributes?.[attribute])
      .filter((n): n is string => typeof n === 'string')
  }

  /** URL of the artwork file closest to ARTWORK_SIZE. */
  artwork(resource: Resource, relationship: string): string | undefined {
    const files = this.related(resource, relationship).flatMap(
      (art) => (art.attributes?.files as { href: string; meta?: { width: number } }[] | undefined) ?? []
    )
    const sorted = [...files].sort(
      (a, b) => Math.abs((a.meta?.width ?? 0) - ARTWORK_SIZE) - Math.abs((b.meta?.width ?? 0) - ARTWORK_SIZE)
    )
    return sorted[0]?.href
  }
}

/** TIDAL API v2 (JSON:API) client for the user's library. */
export class TidalApi {
  private session = new OAuthSession('tidal', () => ({
    authorizeUrl: 'https://login.tidal.com/authorize',
    tokenUrl: 'https://auth.tidal.com/v1/oauth2/token',
    clientId: CLIENT_ID,
    scopes: [
      'user.read',
      'collection.read',
      'collection.write',
      'playlists.read',
      'search.read',
      'recommendations.read'
    ],
    port: 8889
  }))
  private countryCode: string | undefined
  private trackCache = new Map<string, Track>()

  get configured(): boolean {
    return CLIENT_ID !== ''
  }
  get connected(): boolean {
    return this.session.isLoggedIn()
  }
  login = (): Promise<void> => this.session.login()
  logout(): void {
    this.session.logout()
    this.countryCode = undefined
  }

  // ---- HTTP helpers --------------------------------------------------------

  private url(path: string, params: Record<string, string | string[] | undefined> = {}): string {
    const url = new URL(path.startsWith('http') ? path : `${API}${path}`)
    for (const [key, value] of Object.entries(params)) {
      for (const item of asArray(value)) url.searchParams.append(key, item)
    }
    return url.toString()
  }

  private get = (url: string): Promise<Document | undefined> =>
    this.session.request<Document>(url, { headers: { Accept: 'application/vnd.api+json' } })

  private async country(): Promise<string> {
    if (!this.countryCode) {
      const me = await this.get(this.url('/users/me'))
      this.countryCode = String((me?.data as Resource | undefined)?.attributes?.country ?? 'US')
    }
    return this.countryCode
  }

  /** Follows `links.next` and returns all primary data plus included resources. */
  private async getAll(firstUrl: string, maxPages = MAX_PAGES): Promise<{ data: Resource[]; included: Resource[] }> {
    const data: Resource[] = []
    const included: Resource[] = []
    let url: string | undefined = firstUrl
    for (let page = 0; url && page < maxPages; page++) {
      const doc = await this.get(url)
      if (!doc) break
      data.push(...asArray(doc.data))
      included.push(...(doc.included ?? []))
      url = doc.links?.next ? this.url(doc.links.next) : undefined
    }
    return { data, included }
  }

  /** Fetches `/resource?filter[id]=…` in batches, preserving the order of `ids`. */
  private async batch(resource: string, ids: string[], include: string[]): Promise<{ data: Resource[]; included: Included }> {
    const countryCode = await this.country()
    const data: Resource[] = []
    const included: Resource[] = []
    for (let i = 0; i < ids.length; i += BATCH) {
      const doc = await this.get(
        this.url(`/${resource}`, { 'filter[id]': ids.slice(i, i + BATCH), include, countryCode })
      )
      data.push(...asArray(doc?.data))
      included.push(...(doc?.included ?? []))
    }
    const byId = new Map(data.map((r) => [r.id, r]))
    return {
      data: ids.map((id) => byId.get(id)).filter((r): r is Resource => r != null),
      included: new Included(included)
    }
  }

  // ---- Mapping -------------------------------------------------------------

  /** Loads full track objects; tracks unavailable in the user's country are dropped. */
  async tracks(ids: string[]): Promise<Track[]> {
    const missing = ids.filter((id) => !this.trackCache.has(id))
    if (missing.length) {
      const { data, included } = await this.batch('tracks', missing, ['artists', 'albums'])
      for (const track of data) {
        const version = track.attributes?.version ? ` (${track.attributes.version})` : ''
        this.trackCache.set(track.id, {
          id: track.id,
          title: `${track.attributes?.title ?? 'Unknown'}${version}`,
          artist: included.names(track, 'artists', 'name').join(', '),
          album: included.names(track, 'albums', 'title')[0],
          durationMs: isoDurationToMs(track.attributes?.duration)
        })
      }
    }
    return ids.map((id) => this.trackCache.get(id)).filter((t): t is Track => t != null)
  }

  private async albums(ids: string[]): Promise<Collection[]> {
    const { data, included } = await this.batch('albums', ids, ['artists', 'coverArt'])
    return data.map((album) => ({
      kind: 'album' as const,
      id: album.id,
      name: String(album.attributes?.title ?? 'Álbum'),
      subtitle: included.names(album, 'artists', 'name').join(', '),
      trackCount: Number(album.attributes?.numberOfItems ?? 0) || undefined,
      artworkUrl: included.artwork(album, 'coverArt')
    }))
  }

  private async artists(ids: string[]): Promise<Collection[]> {
    const { data, included } = await this.batch('artists', ids, ['profileArt'])
    return data.map((artist) => ({
      kind: 'artist' as const,
      id: artist.id,
      name: String(artist.attributes?.name ?? 'Artista'),
      artworkUrl: included.artwork(artist, 'profileArt')
    }))
  }

  private async playlists(ids: string[], kind: 'playlist' | 'mix' = 'playlist'): Promise<Collection[]> {
    const { data, included } = await this.batch('playlists', ids, ['coverArt'])
    return data.map((playlist) => ({
      kind,
      id: playlist.id,
      name: String(playlist.attributes?.name ?? 'Playlist'),
      subtitle: typeof playlist.attributes?.description === 'string' ? playlist.attributes.description : undefined,
      trackCount: Number(playlist.attributes?.numberOfItems ?? 0) || undefined,
      artworkUrl: included.artwork(playlist, 'coverArt')
    }))
  }

  private idsOf = (data: Linkage[], type: string): string[] => data.filter((r) => r.type === type).map((r) => r.id)

  // ---- Library -------------------------------------------------------------

  async likedTracks(): Promise<Track[]> {
    return this.tracks(await this.likedIds())
  }

  async likedIds(): Promise<string[]> {
    const { data } = await this.getAll(this.url('/userCollectionTracks/me/relationships/items', { sort: '-addedAt' }))
    return this.idsOf(data, 'tracks')
  }

  async setLiked(trackId: string, liked: boolean): Promise<void> {
    await this.session.request(this.url('/userCollectionTracks/me/relationships/items'), {
      method: liked ? 'POST' : 'DELETE',
      body: JSON.stringify({ data: [{ id: trackId, type: 'tracks' }] })
    })
  }

  async userPlaylists(): Promise<Collection[]> {
    const countryCode = await this.country()
    const [favorites, own] = await Promise.all([
      this.getAll(this.url('/userCollectionPlaylists/me/relationships/items', { collectionView: 'FLAT' })),
      this.getAll(this.url('/playlists', { 'filter[owners.id]': 'me', countryCode }))
    ])
    const ids = [...new Set([...this.idsOf(own.data, 'playlists'), ...this.idsOf(favorites.data, 'playlists')])]
    return this.playlists(ids)
  }

  async userAlbums(): Promise<Collection[]> {
    const { data } = await this.getAll(this.url('/userCollectionAlbums/me/relationships/items', { sort: '-addedAt' }))
    return this.albums(this.idsOf(data, 'albums'))
  }

  async userArtists(): Promise<Collection[]> {
    const { data } = await this.getAll(this.url('/userCollectionArtists/me/relationships/items', { sort: '-addedAt' }))
    return this.artists(this.idsOf(data, 'artists'))
  }

  /** Daily, Discovery and New Release mixes. Mixes are playlists of type MIX. */
  async mixes(): Promise<Collection[]> {
    const endpoints = ['userDailyMixes', 'userDiscoveryMixes', 'userNewReleaseMixes']
    const results = await Promise.allSettled(
      endpoints.map((endpoint) => this.getAll(this.url(`/${endpoint}/me/relationships/items`), 2))
    )
    const ids = results.flatMap((r) => (r.status === 'fulfilled' ? this.idsOf(r.value.data, 'playlists') : []))
    if (!ids.length && results.every((r) => r.status === 'rejected')) {
      throw (results[0] as PromiseRejectedResult).reason
    }
    return this.playlists([...new Set(ids)], 'mix')
  }

  async collectionTracks(collection: Collection): Promise<Track[]> {
    const countryCode = await this.country()
    const id = encodeURIComponent(collection.id)
    const path = {
      playlist: `/playlists/${id}/relationships/items`,
      mix: `/playlists/${id}/relationships/items`,
      album: `/albums/${id}/relationships/items`,
      artist: `/artists/${id}/relationships/tracks`
    }[collection.kind]
    const params = collection.kind === 'artist' ? { countryCode, collapseBy: 'FINGERPRINT' } : { countryCode }
    const { data } = await this.getAll(this.url(path, params), collection.kind === 'artist' ? 2 : MAX_PAGES)
    return this.tracks(this.idsOf(data, 'tracks'))
  }

  async search(query: string): Promise<SearchResults> {
    const countryCode = await this.country()
    const q = encodeURIComponent(query)
    const ids = async (relationship: string): Promise<string[]> => {
      const doc = await this.get(this.url(`/searchResults/${q}/relationships/${relationship}`, { countryCode }))
      return this.idsOf(asArray(doc?.data), relationship)
    }
    const [tracks, albums, artists, playlists] = await Promise.all([
      ids('tracks').then((x) => this.tracks(x)),
      ids('albums').then((x) => this.albums(x)),
      ids('artists').then((x) => this.artists(x)),
      ids('playlists').then((x) => this.playlists(x))
    ])
    return { tracks, albums, artists, playlists }
  }

  /** Best-effort lookup of what the TIDAL app is playing (SMTC only gives title/artist). */
  async findTrack(title: string, artist: string): Promise<Track | undefined> {
    const normalize = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const results = await this.search(`${title} ${artist.split(',')[0]}`)
    return (
      results.tracks.find((t) => normalize(t.title) === normalize(title)) ??
      results.tracks.find((t) => normalize(t.title).startsWith(normalize(title)))
    )
  }

  async ensureConnected(): Promise<void> {
    if (!this.connected) throw new ApiError('Conectate a TIDAL para ver tu biblioteca')
  }
}
