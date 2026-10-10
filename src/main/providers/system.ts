import type { PlaybackState, ProviderId } from '@shared/types'
import { smtc, type SmtcSession, type SmtcTarget } from '../smtc/helperClient'
import { ProviderError, type MusicProvider } from './provider'

export function sessionToState(provider: ProviderId, session: SmtcSession | undefined): PlaybackState | null {
  if (!session || (!session.title && !session.artist)) return null
  return {
    provider,
    title: session.title,
    artist: session.artist,
    album: session.album || undefined,
    artworkUrl: session.thumbnail,
    durationMs: session.durationMs,
    positionMs: session.positionMs,
    isPlaying: session.isPlaying,
    volume: null,
    device: session.appId.split('!').pop()
  }
}

/** Watches the Windows media session for `target` and reports it as PlaybackState. */
export function watchSmtc(
  provider: ProviderId,
  target: SmtcTarget,
  onState: (state: PlaybackState | null, session: SmtcSession | undefined) => void
): () => void {
  return smtc.onSessions(() => {
    const session = smtc.session(target)
    onState(sessionToState(provider, session), session)
  })
}

const NO_LIBRARY = 'El modo Sistema no tiene biblioteca: elegí Spotify o Tidal.'

/** Controls whatever player Windows considers current (Spotify, TIDAL, browser, …). */
export class SystemProvider implements MusicProvider {
  readonly id = 'system' as const
  readonly name = 'Sistema (Windows)'
  readonly capabilities = { library: false, search: false, volume: false, seek: true }

  setupHint(): string | undefined {
    return undefined
  }
  isConnected(): boolean {
    return true
  }
  async connect(): Promise<void> {
    smtc.start()
  }
  async disconnect(): Promise<void> {}

  async getPlaylists(): Promise<never> {
    throw new ProviderError(NO_LIBRARY)
  }
  getPlaylistTracks = this.getPlaylists
  getLikedTracks = this.getPlaylists
  search = this.getPlaylists
  playTrack = this.getPlaylists
  playPlaylist = this.getPlaylists

  resume = (): Promise<void> => smtc.send('play', 'any')
  pause = (): Promise<void> => smtc.send('pause', 'any')
  next = (): Promise<void> => smtc.send('next', 'any')
  previous = (): Promise<void> => smtc.send('previous', 'any')
  seek = (positionMs: number): Promise<void> => smtc.send('seek', 'any', { positionMs })
  async setVolume(): Promise<void> {}

  watch(onState: (state: PlaybackState | null) => void): () => void {
    return watchSmtc(this.id, 'any', (state) => onState(state))
  }
}
