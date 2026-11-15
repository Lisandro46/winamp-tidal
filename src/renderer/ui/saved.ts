import type { Collection } from '@shared/types'
import { isSavable, savedKeyOf } from '@shared/saved'
import { library } from './library'
import { toast } from './toast'

const SECTION_OF = { album: 'albums', artist: 'artists', playlist: 'playlists', mix: 'mixes' } as const

const SAVED_MESSAGE: Record<Collection['kind'], [string, string]> = {
  album: ['Álbum guardado en tu biblioteca', 'Álbum quitado de tu biblioteca'],
  playlist: ['Playlist guardada en tu biblioteca', 'Playlist quitada de tu biblioteca'],
  artist: ['Ahora seguís a este artista', 'Dejaste de seguir a este artista'],
  mix: ['', '']
}

/** Which albums, artists and playlists are in the user's library (shared by every list), like `favorites` for songs. */
export const saved = {
  keys: new Set<string>(),
  listeners: new Set<() => void>(),

  set(keys: string[]): void {
    this.keys = new Set(keys)
    this.listeners.forEach((listener) => listener())
  },

  has(collection: Collection): boolean {
    return this.keys.has(savedKeyOf(collection))
  },

  async load(): Promise<void> {
    this.checked.clear()
    try {
      this.set(await window.remote.getSaved())
    } catch {
      // not signed in, or the service has no library: nothing is marked
      this.set([])
    }
  },

  /** Artists already asked about, so scrolling or searching again doesn't repeat the requests. */
  checked: new Set<string>(),

  /** Marks which of these artists are followed (asks YouTube once per artist, only for the ones shown). */
  async resolveArtists(collections: Collection[]): Promise<void> {
    const ids = collections.filter((c) => c.kind === 'artist' && !this.checked.has(c.id)).map((c) => c.id)
    if (!ids.length) return
    ids.forEach((id) => this.checked.add(id))
    try {
      const following = new Set(await window.remote.getFollowing(ids))
      for (const id of ids) {
        if (following.has(id)) this.keys.add(`artist:${id}`)
        else this.keys.delete(`artist:${id}`)
      }
      this.listeners.forEach((listener) => listener())
    } catch {
      ids.forEach((id) => this.checked.delete(id))
    }
  },

  /** Saves (or removes) right away in the UI and confirms with YouTube; puts it back if that fails. */
  async toggle(collection: Collection): Promise<void> {
    if (!isSavable(collection.kind)) return
    const key = savedKeyOf(collection)
    const next = !this.keys.has(key)
    const apply = (on: boolean): void => {
      if (on) this.keys.add(key)
      else this.keys.delete(key)
      this.listeners.forEach((listener) => listener())
    }
    apply(next)
    try {
      await window.remote.setSaved(collection, next)
      library.invalidate(SECTION_OF[collection.kind])
      toast(`${SAVED_MESSAGE[collection.kind][next ? 0 : 1]}: ${collection.name}`)
    } catch {
      apply(!next)
    }
  }
}

/** Reload the marks whenever the login or the account changes. */
export function watchSaved(): void {
  document.addEventListener('auth:changed', () => void saved.load())
  void saved.load()
}
