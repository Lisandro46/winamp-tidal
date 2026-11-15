import type { Collection, CollectionKind } from './types'

/** Playlist ids come both as `PLxxx` and as the browse id `VLPLxxx`. */
export const playlistId = (id: string): string => id.replace(/^VL/, '')

/** Stable key of an album, artist or playlist in the user's library ("album:MPREb_…"). */
export const savedKey = (kind: CollectionKind, id: string): string =>
  `${kind}:${kind === 'playlist' ? playlistId(id) : id}`

export const savedKeyOf = (collection: Collection): string => savedKey(collection.kind, collection.id)

/** Only these can be saved to the library (a mix is an endless radio). */
export const isSavable = (kind: CollectionKind): boolean => kind !== 'mix'
