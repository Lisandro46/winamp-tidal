import type { Collection, CredentialsInfo, SearchResults, TidalCredentials, Track } from '@shared/types'
import { app } from 'electron'
import { ApiError, ClientCredentialsSession, OAuthSession } from '../auth/session'
import { credentialStore } from '../auth/store'

const API = 'https://openapi.tidal.com/v2'
/** Developer builds can bake an app in from .env; installers use the one saved in the setup dialog. */
const BUILD_CREDENTIALS: TidalCredentials = {
  clientId: import.meta.env.MAIN_VITE_TIDAL_CLIENT_ID ?? '',
  clientSecret: import.meta.env.MAIN_VITE_TIDAL_CLIENT_SECRET ?? ''
}
const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token'
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

const NEEDS_LOGIN = 'Tu biblioteca necesita el login de TIDAL (pendiente de que TIDAL habilite la app)'
const NEEDS_CATALOG = 'Para buscar en TIDAL activá el modo catálogo con el botón "TIDAL…" de la Media Library'

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
  private credentials = credentialStore.get() ?? BUILD_CREDENTIALS
  private session = new OAuthSession('tidal', () => ({
    authorizeUrl: 'https://login.tidal.com/authorize',
    tokenUrl: 'https://auth.tidal.com/v1/oauth2/token',
    clientId: this.credentials.clientId,
    scopes: [
      'user.read',
      'collection.read',
      'collection.write',
      'playlists.read',
      'search.read',
      'recommendations.read'
    ],
    port: 8889,
    // TIDAL rejects localhost/http redirects; this page forwards to 127.0.0.1:8889.
    redirectUri: 'https://lisandro46.github.io/winamp-remote-callback/'
  }))
  private catalog = this.catalogSession(this.credentials)
  private countryCode: string | undefined
  private trackCache = new Map<string, Track>()
  private albumOfTrack = new Map<string, string>()
  /** Track ids of an album in play order (all discs). */
  private albumOrder = new Map<string, string[]>()

  private catalogSession({ clientId, clientSecret }: TidalCredentials): ClientCredentialsSession {
    return new ClientCredentialsSession(TOKEN_URL, clientId, clientSecret)
  }

  get configured(): boolean {
    return this.credentials.clientId !== ''
  }

  credentialsInfo(): CredentialsInfo {
    const { clientId, clientSecret } = this.credentials
    const source = credentialStore.get() ? 'saved' : BUILD_CREDENTIALS.clientId ? 'build' : 'none'
    return { clientId, hasSecret: clientSecret !== '', source }
  }

  /**
   * Switches to the user's own TIDAL app after checking it with TIDAL, or back to
   * the build's (usually none) with `null`. A login made with another app is dropped.
   */
  async setCredentials(credentials: TidalCredentials | null): Promise<void> {
    const next = credentials
      ? { clientId: credentials.clientId.trim(), clientSecret: credentials.clientSecret.trim() }
      : BUILD_CREDENTIALS
    const catalog = this.catalogSession(next)
    if (credentials) {
      if (!catalog.configured) throw new ApiError('Pegá el Client ID y el Client Secret de tu app de TIDAL')
      try {
        await catalog.check()
      } catch {
        throw new ApiError('TIDAL no aceptó ese Client ID / Client Secret. Revisá que estén bien copiados.')
      }
    }
    credentialStore.set(credentials ? next : undefined)
    if (next.clientId !== this.credentials.clientId) this.logout()
    this.credentials = next
    this.catalog = catalog
  }
  get connected(): boolean {
    return this.session.isLoggedIn()
  }
  /** Catalog requests (search, albums, artists, public playlists) work without a user. */
  get catalogAvailable(): boolean {
    return this.connected || this.catalog.configured
  }
  async login(): Promise<void> {
    await this.session.login()
    this.countryCode = undefined
  }
  logout(): void {
    this.session.logout()
    this.countryCode = undefined
  }

  // ---- HTTP helpers --------------------------------------------------------

  private url(path: string, params: Record<string, string | string[] | undefined> = {}): string {
    const url = new URL(path.startsWith('http') ? path : `${API}${path}`)
    for (const [key, value] of Object.entries(params)) {
      // TIDAL only reads the first of repeated `include` params; filters can repeat.
      const items = key === 'include' ? [asArray(value).join(',')].filter(Boolean) : asArray(value)
      for (const item of items) url.searchParams.append(key, item)
    }
    return url.toString()
  }

  /** Uses the user's session when logged in, otherwise the app's catalog token. */
  private get = (url: string): Promise<Document | undefined> => {
    const init = { headers: { Accept: 'application/vnd.api+json' } }
    if (this.connected) return this.session.request<Document>(url, init)
    if (this.catalog.configured) return this.catalog.request<Document>(url, init)
    throw new ApiError(NEEDS_LOGIN)
  }

  private async country(): Promise<string> {
    if (!this.countryCode) {
      if (this.connected) {
        const me = await this.get(this.url('/users/me'))
        this.countryCode = String((me?.data as Resource | undefined)?.attributes?.country ?? 'US')
      } else {
        // No user yet: use Windows' region so the catalog matches what TIDAL offers there.
        this.countryCode = app.getLocaleCountryCode() || 'US'
      }
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
        const albumId = asArray(track.relationships?.albums?.data)[0]?.id
        if (albumId) this.albumOfTrack.set(track.id, albumId)
      }
    }
    return ids.map((id) => this.trackCache.get(id)).filter((t): t is Track => t != null)
  }

  /**
   * The album a track belongs to and its position there. TIDAL's deep links can
   * only start albums (and playlists, artists, mixes) from their first track.
   */
  async albumPosition(trackId: string): Promise<{ albumId: string; index: number; tracks: Track[] } | undefined> {
    if (!this.albumOfTrack.has(trackId)) {
      this.trackCache.delete(trackId)
      await this.tracks([trackId])
    }
    const albumId = this.albumOfTrack.get(trackId)
    if (!albumId) return undefined
    let order = this.albumOrder.get(albumId)
    if (!order) {
      const countryCode = await this.country()
      const { data } = await this.getAll(this.url(`/albums/${encodeURIComponent(albumId)}/relationships/items`, { countryCode }))
      order = data.map((item) => item.id)
      this.albumOrder.set(albumId, order)
    }
    const index = order.indexOf(trackId)
    // Titles let the player tell where in the album TIDAL is.
    return index >= 0 ? { albumId, index, tracks: await this.tracks(order) } : undefined
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
    // `include` makes one request return the ids of every result type; details are batch-loaded below.
    const doc = await this.get(
      this.url('/searchResults', {
        'filter[query]': query,
        countryCode,
        include: ['tracks', 'albums', 'artists', 'playlists']
      })
    )
    const result = asArray(doc?.data)[0]
    const ids = (relationship: string): string[] =>
      this.idsOf(asArray(result?.relationships?.[relationship]?.data), relationship)
    const [tracks, albums, artists, playlists] = await Promise.all([
      this.tracks(ids('tracks')),
      this.albums(ids('albums')),
      this.artists(ids('artists')),
      this.playlists(ids('playlists'))
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

  /** Favorites, playlists, mixes… belong to a user and need a login. */
  async ensureUser(): Promise<void> {
    if (!this.connected) throw new ApiError(NEEDS_LOGIN)
  }

  async ensureCatalog(): Promise<void> {
    if (!this.catalogAvailable) throw new ApiError(NEEDS_CATALOG)
  }
}
