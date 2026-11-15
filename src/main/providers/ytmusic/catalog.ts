import { Innertube } from 'youtubei.js'
import type { Collection, CollectionKind, PlaylistChoice, SearchResults, Track } from '@shared/types'
import { playlistId, savedKey } from '@shared/saved'
import { parseAccounts, type AccountItemLike, type RawAccount } from './accounts'

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
  endpoint?: { payload?: { browseId?: string } }
}

/** Songs sent to YouTube per playlist edit. */
const ADD_BATCH = 100
/** A node of the "up next" panel (a song, or a wrapper around one). */
interface RadioNode {
  primary?: RadioNode | null
  video_id?: string
  title?: string | Text
  artists?: { name: string }[]
  author?: string
  duration?: { seconds?: number }
}

const MAX_PLAYLIST_PAGES = 10
/** Pages of the library (albums, artists, playlists) to read; each holds about 20 items. */
const MAX_LIBRARY_PAGES = 15
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
  // Artists of the user's library carry no id, only a "MPLA<channel>" browse id.
  const id = item.id ?? item.endpoint?.payload?.browseId?.replace(/^MPLA/, '')
  if (!id) return undefined
  const cols = columns(item)
  return {
    kind,
    id,
    name: text(item.title) || item.name || cols[0] || '',
    subtitle: item.author?.name || withoutKind(text(item.subtitle) || cols[1] || '') || undefined,
    artworkUrl: artwork(item)
  }
}

const collectionsOf = (items: Item[] | undefined, kind: CollectionKind): Collection[] =>
  (items ?? []).map((item) => toCollection(item, kind)).filter((c): c is Collection => c != null)

type LibraryPage = { contents: unknown; has_continuation: boolean; getContinuation(): Promise<LibraryPage> }

const KIND_OF: Record<string, CollectionKind> = { album: 'album', playlist: 'playlist', artist: 'artist' }

export class YtCatalog {
  private client: Promise<Innertube> | undefined
  private cookie = ''
  /** Brand account's page id to act as; unset for the Google account's own channel. */
  private pageId: string | undefined

  /** Uses the music.youtube.com login's cookies, or none for anonymous search. */
  setCookie(cookie: string): void {
    if (cookie === this.cookie && this.client) return
    this.cookie = cookie
    this.client = undefined
  }

  /** Acts as another channel of the same login (the library, likes and mixes follow it). */
  setAccount(pageId: string | undefined): void {
    if (pageId === this.pageId) return
    this.pageId = pageId
    this.client = undefined
  }

  /** The channels behind this login. Needs a client without a page id (YouTube rejects the list otherwise). */
  async accounts(): Promise<RawAccount[]> {
    if (!this.loggedIn) return []
    const yt = await Innertube.create({ lang: 'es', location: 'AR', retrieve_player: false, cookie: this.cookie })
    return parseAccounts((await yt.account.getInfo(true)) as unknown as AccountItemLike[])
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
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.pageId ? { on_behalf_of_user: this.pageId } : {})
      })
      // Failed creations (offline) are retried on the next call.
      client.catch(() => {
        if (this.client === client) this.client = undefined
      })
      this.client = client
    }
    return this.client
  }

  /**
   * The radio (mix) YouTube Music builds from a song: what its "up next" and "start radio" show.
   * The seed song comes first. Works without an account.
   */
  async radio(videoId: string, label?: string): Promise<Track[]> {
    const yt = await this.yt()
    const panel = (await yt.music.getUpNext(videoId, true)) as unknown as { contents?: RadioNode[] }
    const seen = new Set<string>()
    const tracks: Track[] = []
    for (const node of panel.contents ?? []) {
      const video = node.primary ?? node
      const id = video.video_id
      if (!id || id.length !== 11 || seen.has(id)) continue
      seen.add(id)
      tracks.push({
        id,
        title: text(video.title),
        artist: video.artists?.map((a) => a.name).join(', ') || video.author || '',
        durationMs: (video.duration?.seconds ?? 0) * 1000
      })
    }
    // The album slot says where these songs came from.
    const tag = label ?? `Radio · ${tracks[0]?.title ?? ''}`.trim()
    return tracks.map((t) => ({ ...t, album: tag }))
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
    // The library comes a page at a time (about 20 albums or artists); follow the rest.
    let page: { has_continuation: boolean; getContinuation(): Promise<LibraryPage> } = library
    for (let i = 0; i < MAX_LIBRARY_PAGES && page.has_continuation; i++) {
      const next = await page.getContinuation()
      const more = next.contents as { items?: Item[]; contents?: Item[] }
      items.push(...(more.items ?? more.contents ?? []))
      page = next
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

  /**
   * Thumbs-up / remove it, for a song (`videoId`) or a playlist/album (`playlistId`). Sent as YouTube
   * Music itself does: youtubei.js' own `interact.like` uses the TV client, which answers 400 here.
   */
  private async rate(target: { videoId: string } | { playlistId: string }, like: boolean): Promise<void> {
    const yt = await this.yt()
    await yt.actions.execute(like ? '/like/like' : '/like/removelike', { target, client: 'YTMUSIC' })
  }

  async setLiked(videoId: string, liked: boolean): Promise<void> {
    this.ensureLogin()
    await this.rate({ videoId }, liked)
  }

  // ---- Library edits ---------------------------------------------------------------

  /** Keys of the albums, artists and playlists saved in the user's library. */
  async savedKeys(): Promise<string[]> {
    this.ensureLogin()
    // Artists are not here: the library's artist list is not who the user follows, so their
    // state is asked per artist (`followingArtists`).
    const [playlists, albums] = await Promise.all([this.userPlaylists().catch(() => []), this.userAlbums().catch(() => [])])
    return [...playlists, ...albums].map((c) => savedKey(c.kind, c.id))
  }

  /** Which of these artists the user follows, read from each artist's page. */
  async followingArtists(ids: string[]): Promise<string[]> {
    this.ensureLogin()
    const yt = await this.yt()
    const following: string[] = []
    const ask = async (id: string): Promise<void> => {
      try {
        const artist = await yt.music.getArtist(id)
        const button = (artist.header as { subscription_button?: { subscribed?: boolean } } | undefined)?.subscription_button
        if (button?.subscribed) following.push(id)
      } catch {
        // an artist that can't be read just shows as not followed
      }
    }
    for (let i = 0; i < ids.length; i += 4) await Promise.all(ids.slice(i, i + 4).map(ask))
    return following
  }

  private static assertOk(response: { success: boolean; status_code: number }, what: string): void {
    if (!response.success) throw new Error(`YouTube Music no pudo ${what} (error ${response.status_code}).`)
  }

  /** An album is saved through its audio playlist ("OLAK5uy…"), which only its page knows. */
  private async albumPlaylistId(browseId: string): Promise<string> {
    const yt = await this.yt()
    const album = await yt.music.getAlbum(browseId)
    const buttons = ((album.header as { buttons?: { type?: string; endpoint?: { payload?: { playlistId?: string } } }[] } | undefined)
      ?.buttons ?? [])
    const id = buttons.find((b) => b.type === 'MusicPlayButton')?.endpoint?.payload?.playlistId
    if (!id) throw new Error('No se encontró cómo guardar este álbum en YouTube Music.')
    return id
  }

  /** An artist is followed through its channel, whose id differs from the artist page's. */
  private async artistChannelId(browseId: string): Promise<string> {
    const yt = await this.yt()
    const artist = await yt.music.getArtist(browseId)
    const id = (artist.header as { subscription_button?: { channel_id?: string } } | undefined)?.subscription_button?.channel_id
    if (!id) throw new Error('No se encontró el canal de este artista.')
    return id
  }

  async setSaved(collection: Collection, saved: boolean): Promise<void> {
    this.ensureLogin()
    const yt = await this.yt()
    if (collection.kind === 'artist') {
      const channel = await this.artistChannelId(collection.id)
      // Like the other actions this must go through the YouTube Music client or it is accepted but ignored.
      const response = await yt.actions.execute(saved ? '/subscription/subscribe' : '/subscription/unsubscribe', {
        channelIds: [channel],
        params: saved ? 'EgIIAhgA' : 'CgIIAhgA',
        client: 'YTMUSIC'
      })
      YtCatalog.assertOk(response, saved ? 'seguir al artista' : 'dejar de seguir al artista')
      return
    }
    if (collection.kind === 'mix') throw new Error('Los mixes no se guardan en la biblioteca.')
    const target = collection.kind === 'album' ? await this.albumPlaylistId(collection.id) : playlistId(collection.id)
    await this.rate({ playlistId: target }, saved)
  }

  /**
   * The playlists the user can add songs to: the same list music.youtube.com shows under
   * "Guardar en playlist", so other people's saved playlists are left out.
   */
  async editablePlaylists(videoIds: string[]): Promise<PlaylistChoice[]> {
    this.ensureLogin()
    const yt = await this.yt()
    const response = await yt.actions.execute('/playlist/get_add_to_playlist', {
      videoIds: videoIds.slice(0, 1),
      excludeWatchLater: true,
      client: 'YTMUSIC'
    })
    const found: PlaylistChoice[] = []
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk)
      if (!node || typeof node !== 'object') return
      const option = (node as { playlistAddToOptionRenderer?: Record<string, unknown> }).playlistAddToOptionRenderer
      if (option) {
        const title = option.title as { simpleText?: string; runs?: { text: string }[] } | undefined
        const name = title?.simpleText ?? title?.runs?.map((r) => r.text).join('') ?? ''
        const id = option.playlistId as string | undefined
        // "Liked music" is what the heart does, not a playlist to edit.
        if (id && name && id !== 'LM') found.push({ id, name })
        return
      }
      Object.values(node).forEach(walk)
    }
    walk(response.data)
    return found
  }

  /** Adds the songs the playlist doesn't have yet (YouTube would happily add them twice); returns how many were new. */
  async addToPlaylist(id: string, videoIds: string[]): Promise<number> {
    this.ensureLogin()
    if (!videoIds.length) throw new Error('No hay temas para agregar.')
    const yt = await this.yt()
    const target = playlistId(id)
    const have = new Set((await this.playlistTracks(target).catch(() => [])).map((t) => t.id))
    const fresh = [...new Set(videoIds)].filter((v) => !have.has(v))
    for (let i = 0; i < fresh.length; i += ADD_BATCH) {
      const result = await yt.playlist.addVideos(target, fresh.slice(i, i + ADD_BATCH))
      const status = (result.action_result as { status?: string }[] | undefined)?.find((a) => a.status)?.status
      if (status && status !== 'STATUS_SUCCEEDED') throw new Error('YouTube Music no pudo agregar los temas a esa playlist.')
    }
    return fresh.length
  }

  async createPlaylist(name: string, videoIds: string[]): Promise<PlaylistChoice> {
    this.ensureLogin()
    const title = name.trim()
    if (!title) throw new Error('Escribí un nombre para la playlist.')
    if (!videoIds.length) throw new Error('No hay temas para agregar.')
    const yt = await this.yt()
    const first = videoIds.slice(0, ADD_BATCH)
    const created = await yt.playlist.create(title, first)
    if (!created.success || !created.playlist_id) throw new Error('YouTube Music no pudo crear la playlist.')
    if (videoIds.length > first.length) await this.addToPlaylist(created.playlist_id, videoIds.slice(first.length))
    return { id: created.playlist_id, name: title }
  }
}
