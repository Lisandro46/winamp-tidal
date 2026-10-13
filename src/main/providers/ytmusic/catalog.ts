import { Innertube } from 'youtubei.js'
import type { Collection, CollectionKind, SearchResults, Track } from '@shared/types'

/**
 * YouTube Music's catalog and the user's library through InnerTube (the API the
 * music.youtube.com page itself uses), via youtubei.js. YouTube has no public
 * music API, so this is where breakage would show up first.
 */

// youtubei.js models are loosely typed unions; only the fields used here.
interface Text {
  toString(): string
}
interface Thumb {
  url: string
  width?: number
}
interface Item {
  type?: string
  item_type?: string
  id?: string
  title?: string | Text
  name?: string
  subtitle?: Text
  author?: { name?: string }
  artists?: { name: string }[]
  album?: { name?: string }
  duration?: { seconds?: number; text?: string }
  thumbnails?: Thumb[]
  thumbnail?: { contents?: Thumb[] } | Thumb[]
  flex_columns?: { title?: Text }[]
}

const MAX_PLAYLIST_PAGES = 10
/** Home page sections to look through for the user's mixes. */
const HOME_PAGES = 4
const NEEDS_LOGIN = 'Iniciá sesión en YouTube Music para ver tu biblioteca'

const text = (value: string | Text | undefined): string => (value == null ? '' : String(value)).trim()
const columns = (item: Item): string[] => (item.flex_columns ?? []).map((c) => text(c.title))
/** "Álbum • Soda Stereo • 1984" → "Soda Stereo • 1984" */
const withoutKind = (value: string): string => value.replace(/^[^•]+•\s*/, '')

function artwork(item: Item): string | undefined {
  const list = Array.isArray(item.thumbnail) ? item.thumbnail : (item.thumbnail?.contents ?? item.thumbnails ?? [])
  return [...list].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url
}

function seconds(value: string): number {
  const parts = value.split(':').map(Number)
  if (!parts.length || parts.some(Number.isNaN)) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}

function toTrack(item: Item, fallbackArtist = '', fallbackAlbum?: string): Track | undefined {
  if (!item.id || item.id.length !== 11) return undefined
  const cols = columns(item)
  const durationText = item.duration?.text ?? cols.find((c) => /^\d+:\d\d(:\d\d)?$/.test(c)) ?? ''
  return {
    id: item.id,
    title: text(item.title) || cols[0] || '',
    artist: item.artists?.map((a) => a.name).join(', ') || item.author?.name || fallbackArtist || cols[1] || '',
    album: item.album?.name ?? fallbackAlbum,
    durationMs: (item.duration?.seconds ?? seconds(durationText)) * 1000
  }
}

const tracksOf = (items: Item[] | undefined, artist?: string, album?: string): Track[] =>
  (items ?? []).map((item) => toTrack(item, artist, album)).filter((t): t is Track => t != null)

function toCollection(item: Item, kind: CollectionKind): Collection | undefined {
  if (!item.id) return undefined
  const cols = columns(item)
  return {
    kind,
    id: item.id,
    name: text(item.title) || item.name || cols[0] || '',
    subtitle: item.author?.name || withoutKind(text(item.subtitle) || cols[1] || '') || undefined,
    artworkUrl: artwork(item)
  }
}

const collectionsOf = (items: Item[] | undefined, kind: CollectionKind): Collection[] =>
  (items ?? []).map((item) => toCollection(item, kind)).filter((c): c is Collection => c != null)

const KIND_OF: Record<string, CollectionKind> = { album: 'album', playlist: 'playlist', artist: 'artist' }

export class YtCatalog {
  private client: Promise<Innertube> | undefined
  private cookie = ''

  /** Uses the music.youtube.com login's cookies, or none for anonymous search. */
  setCookie(cookie: string): void {
    if (cookie === this.cookie && this.client) return
    this.cookie = cookie
    this.client = undefined
  }

  get loggedIn(): boolean {
    return /(^|; )(__Secure-3PAPISID|SAPISID)=/.test(this.cookie)
  }

  private yt(): Promise<Innertube> {
    if (!this.client) {
      const client = Innertube.create({
        lang: 'es',
        location: 'AR',
        retrieve_player: false,
        ...(this.cookie ? { cookie: this.cookie } : {})
      })
      // Failed creations (offline) are retried on the next call.
      client.catch(() => {
        if (this.client === client) this.client = undefined
      })
      this.client = client
    }
    return this.client
  }

  private ensureLogin(): void {
    if (!this.loggedIn) throw new Error(NEEDS_LOGIN)
  }

  async search(query: string): Promise<SearchResults> {
    const yt = await this.yt()
    const shelf = async (type: 'song' | 'album' | 'artist' | 'playlist'): Promise<Item[]> => {
      const result = await yt.music.search(query, { type })
      return ((result.contents?.[0] as { contents?: Item[] } | undefined)?.contents ?? []) as Item[]
    }
    const [songs, albums, artists, playlists] = await Promise.all(
      (['song', 'album', 'artist', 'playlist'] as const).map((type) => shelf(type).catch(() => []))
    )
    return {
      tracks: tracksOf(songs),
      albums: collectionsOf(albums, 'album'),
      artists: collectionsOf(artists, 'artist'),
      playlists: collectionsOf(playlists, 'playlist')
    }
  }

  private async playlistTracks(id: string, maxPages = MAX_PLAYLIST_PAGES): Promise<Track[]> {
    const yt = await this.yt()
    let page = await yt.music.getPlaylist(id)
    const items = [...((page.items ?? []) as Item[])]
    for (let i = 1; i < maxPages && page.has_continuation; i++) {
      page = await page.getContinuation()
      items.push(...((page.items ?? []) as Item[]))
    }
    return tracksOf(items)
  }

  async collectionTracks(collection: Collection): Promise<Track[]> {
    const yt = await this.yt()
    if (collection.kind === 'album') {
      const album = await yt.music.getAlbum(collection.id)
      const header = album.header as { title?: Text; strapline_text_one?: Text } | undefined
      return tracksOf(album.contents as Item[], text(header?.strapline_text_one), text(header?.title) || collection.name)
    }
    if (collection.kind === 'artist') {
      const artist = await yt.music.getArtist(collection.id)
      const shelf = artist.sections.find((s) => s.type === 'MusicShelf') as
        | { contents?: Item[]; endpoint?: { payload?: { browseId?: string } } }
        | undefined
      // "Top songs" links to a playlist with all of them; the shelf only shows five.
      const all = shelf?.endpoint?.payload?.browseId
      if (all) return this.playlistTracks(all, 2).catch(() => tracksOf(shelf?.contents, collection.name))
      return tracksOf(shelf?.contents, collection.name)
    }
    // Mixes are endless radios: a couple of pages is plenty.
    return this.playlistTracks(collection.id, collection.kind === 'mix' ? 2 : MAX_PLAYLIST_PAGES)
  }

  // ---- Library (needs the login) ------------------------------------------------

  async likedTracks(): Promise<Track[]> {
    this.ensureLogin()
    return this.playlistTracks('LM')
  }

  private async libraryItems(filter: RegExp): Promise<Item[]> {
    this.ensureLogin()
    const yt = await this.yt()
    let library = await yt.music.getLibrary()
    const name = library.filters.find((f) => filter.test(f))
    if (name) library = await library.applyFilter(name)
    const items: Item[] = []
    for (const section of library.contents ?? []) {
      items.push(...(((section as { contents?: Item[] }).contents ?? []) as Item[]))
    }
    return items
  }

  async userPlaylists(): Promise<Collection[]> {
    const items = await this.libraryItems(/playlist|lista/i)
    // The grid starts with a "New playlist" button and the auto "Liked music" list.
    return collectionsOf(
      items.filter((i) => i.id && i.id !== 'VLLM' && i.id !== 'LM'),
      'playlist'
    )
  }

  async userAlbums(): Promise<Collection[]> {
    return collectionsOf(await this.libraryItems(/álbum|album/i), 'album')
  }

  async userArtists(): Promise<Collection[]> {
    return collectionsOf(await this.libraryItems(/artist/i), 'artist')
  }

  /** Personal mixes ("Mi mix 1", "Supermix"…) from the home page. */
  async mixes(): Promise<Collection[]> {
    this.ensureLogin()
    const yt = await this.yt()
    // The mixes shelf is usually a few sections down the home page.
    let home = await yt.music.getHomeFeed()
    const sections = [...(home.sections ?? [])] as { header?: { title?: Text }; contents?: Item[] }[]
    for (let page = 1; page < HOME_PAGES && home.has_continuation; page++) {
      home = await home.getContinuation()
      sections.push(...((home.sections ?? []) as typeof sections))
    }
    const isPlaylist = (i: Item): boolean => KIND_OF[i.item_type ?? ''] === 'playlist' || !!i.id?.startsWith('RD')
    const items = sections.flatMap((s) =>
      (s.contents ?? []).filter((i) => isPlaylist(i) && (/mix/i.test(text(s.header?.title)) || /mix/i.test(text(i.title))))
    )
    const unique = [...new Map(items.map((i) => [i.id, i])).values()]
    return collectionsOf(unique, 'mix')
  }

  async setLiked(videoId: string, liked: boolean): Promise<void> {
    this.ensureLogin()
    const yt = await this.yt()
    if (liked) await yt.interact.like(videoId)
    else await yt.interact.removeRating(videoId)
  }
}
