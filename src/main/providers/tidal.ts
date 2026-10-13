import type { Collection, CredentialsInfo, PlayContext, PlaybackState, SearchResults, TidalCredentials, Track } from '@shared/types'
import { TidalApi } from '../tidal/api'
import { TidalPlayer } from '../tidal/player'
import type { MusicProvider } from './types'

/** TIDAL: catalog through its API, playback by remote-controlling the TIDAL desktop app. */
export class TidalProvider implements MusicProvider {
  readonly id = 'tidal'
  readonly name = 'TIDAL'
  readonly capabilities = { credentials: true, mixes: true, externalApp: true }

  private readonly api = new TidalApi()
  private readonly player: TidalPlayer

  constructor(onLikedChange: (ids: string[]) => void) {
    this.player = new TidalPlayer(this.api, onLikedChange)
  }

  get configured(): boolean {
    return this.api.configured
  }
  get connected(): boolean {
    return this.api.connected
  }
  get catalogAvailable(): boolean {
    return this.api.catalogAvailable
  }
  login(): Promise<void> {
    return this.api.login()
  }
  async logout(): Promise<void> {
    this.api.logout()
  }
  ensureUser(): Promise<void> {
    return this.api.ensureUser()
  }
  ensureCatalog(): Promise<void> {
    return this.api.ensureCatalog()
  }

  /** The user's own TIDAL developer app, for catalog mode. */
  credentialsInfo(): CredentialsInfo {
    return this.api.credentialsInfo()
  }
  setCredentials(credentials: TidalCredentials | null): Promise<void> {
    return this.api.setCredentials(credentials)
  }

  search(query: string): Promise<SearchResults> {
    return this.api.search(query)
  }
  collectionTracks(collection: Collection): Promise<Track[]> {
    return this.api.collectionTracks(collection)
  }
  likedTracks(): Promise<Track[]> {
    return this.api.likedTracks()
  }
  userPlaylists(): Promise<Collection[]> {
    return this.api.userPlaylists()
  }
  userAlbums(): Promise<Collection[]> {
    return this.api.userAlbums()
  }
  userArtists(): Promise<Collection[]> {
    return this.api.userArtists()
  }
  mixes(): Promise<Collection[]> {
    return this.api.mixes()
  }

  loadLiked(): Promise<void> {
    return this.player.loadLiked()
  }
  likedIds(): string[] {
    return this.player.likedIds()
  }
  setLiked(trackId: string, liked: boolean): Promise<void> {
    return this.player.setLiked(trackId, liked)
  }

  playTrack(context: PlayContext): Promise<void> {
    return this.player.playTrack(context)
  }
  setQueue(tracks: Track[]): void {
    this.player.setQueue(tracks)
  }
  resume(): Promise<void> {
    return this.player.resume()
  }
  pause(): Promise<void> {
    return this.player.pause()
  }
  next(): Promise<void> {
    return this.player.next()
  }
  previous(): Promise<void> {
    return this.player.previous()
  }
  seek(positionMs: number): Promise<void> {
    return this.player.seek(positionMs)
  }
  watch(onState: (state: PlaybackState | null) => void): () => void {
    return this.player.watch(onState)
  }

  // The TIDAL app keeps running on its own; just stop driving it.
  async dispose(): Promise<void> {
    await this.player.pause().catch(() => undefined)
  }
}
