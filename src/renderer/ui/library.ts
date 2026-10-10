import type { Collection, Track } from '@shared/types'

export type Section = 'mixes' | 'playlists' | 'albums' | 'artists'

export const SECTIONS: { section: Section; label: string }[] = [
  { section: 'mixes', label: 'Mixes para vos' },
  { section: 'playlists', label: 'Playlists' },
  { section: 'albums', label: 'Álbumes' },
  { section: 'artists', label: 'Artistas' }
]

const loaders: Record<Section, () => Promise<Collection[]>> = {
  mixes: () => window.remote.getMixes(),
  playlists: () => window.remote.getPlaylists(),
  albums: () => window.remote.getAlbums(),
  artists: () => window.remote.getArtists()
}

/** Library data shared by the Media Library and the search dialog, cached per session. */
const cache = new Map<string, Promise<unknown>>()

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  let entry = cache.get(key) as Promise<T> | undefined
  if (!entry) {
    entry = load()
    cache.set(key, entry)
    // Failed loads are retried next time instead of caching the error.
    entry.catch(() => cache.delete(key))
  }
  return entry
}

export const library = {
  liked: (): Promise<Track[]> => cached('liked', () => window.remote.getLikedTracks()),
  section: (section: Section): Promise<Collection[]> => cached(section, loaders[section]),
  tracks: (collection: Collection): Promise<Track[]> =>
    cached(`${collection.kind}:${collection.id}`, () => window.remote.getTracks(collection)),
  invalidate(key?: string): void {
    if (key) cache.delete(key)
    else cache.clear()
  }
}

/** Shared favorites state, kept in sync with the main process. */
export const favorites = {
  ids: new Set<string>(),
  listeners: new Set<() => void>(),
  set(ids: string[]): void {
    this.ids = new Set(ids)
    this.listeners.forEach((listener) => listener())
  },
  toggle(trackId: string): void {
    library.invalidate('liked')
    void window.remote.setLiked(trackId, !this.ids.has(trackId)).catch(() => undefined)
  }
}
