import { shell } from 'electron'
import type { PlayContext, PlaybackState, Track } from '@shared/types'
import { smtc, type SmtcSession } from '../smtc/helperClient'
import type { TidalApi } from './api'

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]\s*/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** SMTC only exposes title/artist, so tracks are matched by (normalized) title. */
const sameTrack = (session: SmtcSession, track: Track): boolean => {
  const a = normalize(session.title)
  const b = normalize(track.title)
  return a === b || a.startsWith(b) || b.startsWith(a)
}

const sessionKey = (session: SmtcSession): string => `${session.title}|${session.artist}`

/**
 * Drives the TIDAL desktop app. TIDAL's remote playback API is internal-only, so:
 *  - transport commands go through the Windows media session (works without login)
 *  - starting a specific track uses tidal:// deep links
 *  - the app keeps its own queue and advances it when a track ends
 */
export class TidalPlayer {
  private queue: Track[] = []
  private index = -1
  private lastSession: SmtcSession | undefined
  /** While a deep link is opening, TIDAL still reports the previous track. */
  private openingUntil = 0
  /** TIDAL ids for "title|artist" of tracks not started from our queue. */
  private resolved = new Map<string, Track | null>()
  private liked = new Set<string>()

  constructor(
    private readonly api: TidalApi,
    private readonly onLikedChange: (ids: string[]) => void
  ) {}

  // ---- Favorites -------------------------------------------------------------

  async loadLiked(): Promise<void> {
    this.liked = new Set(this.api.connected ? await this.api.likedIds() : [])
    this.onLikedChange([...this.liked])
  }

  likedIds(): string[] {
    return [...this.liked]
  }

  async setLiked(trackId: string, liked: boolean): Promise<void> {
    await this.api.setLiked(trackId, liked)
    if (liked) this.liked.add(trackId)
    else this.liked.delete(trackId)
    this.onLikedChange([...this.liked])
  }

  // ---- Transport -------------------------------------------------------------

  /** Polls the TIDAL media session until `done` holds; returns the last session seen. */
  private async waitFor(done: (session: SmtcSession) => boolean, timeoutMs: number): Promise<SmtcSession | undefined> {
    const until = Date.now() + timeoutMs
    let session = smtc.session('tidal')
    while (Date.now() < until && !(session && done(session))) {
      await new Promise((r) => setTimeout(r, 150))
      session = smtc.session('tidal')
    }
    return session
  }

  /**
   * TIDAL's deep links can't start a single track: `?play=true` only starts an
   * album (or playlist, artist, mix) from its first track. So we start the
   * track's album and press "next" until TIDAL reaches the chosen track.
   */
  private async open(index: number): Promise<void> {
    const track = this.queue[index]
    if (!track) return
    this.index = index
    this.openingUntil = Date.now() + 60_000
    try {
      const before = smtc.session('tidal')
      if (before && sameTrack(before, track)) {
        await smtc.send('seek', 'tidal', { positionMs: 0 })
        if (!before.isPlaying) await smtc.send('play', 'tidal')
        return
      }
      const position = await this.api.albumPosition(track.id).catch(() => undefined)
      const beforeKey = before ? sessionKey(before) : ''
      // TIDAL ignores a link to the page it's already showing, so leave it first.
      await shell.openExternal('tidal://home')
      await new Promise((r) => setTimeout(r, 400))
      await shell.openExternal(
        position ? `tidal://album/${position.albumId}?play=true` : `tidal://track/${track.id}?play=true`
      )
      // Wait for the album to start (a new song, or ours if it's the first one).
      const started = (s: SmtcSession): boolean => sameTrack(s, track) || (s.isPlaying && sessionKey(s) !== beforeKey)
      let session = await this.waitFor(started, 8000)
      if (!position || !session || !started(session)) return
      // Skip towards our track. TIDAL drops commands sent while a song loads, so
      // after each burst see where it landed in the album and correct.
      for (let round = 0; round < 8 && session && !sameTrack(session, track); round++) {
        const at = position.tracks.findIndex((t) => sameTrack(session!, t))
        const delta = at >= 0 ? position.index - at : 1
        const key = sessionKey(session)
        for (let i = 0; i < Math.abs(delta); i++) {
          await smtc.send(delta > 0 ? 'next' : 'previous', 'tidal').catch(() => undefined)
          await new Promise((r) => setTimeout(r, 300))
        }
        session = await this.waitFor((s) => sessionKey(s) !== key, 2500)
        // Let the remaining commands land before looking again.
        await new Promise((r) => setTimeout(r, 600))
        session = smtc.session('tidal')
      }
      if (session && !session.isPlaying) await smtc.send('play', 'tidal').catch(() => undefined)
    } finally {
      this.openingUntil = 0
    }
  }

  async playTrack(context: PlayContext): Promise<void> {
    this.queue = context.tracks
    await this.open(context.index)
  }

  /** The Winamp playlist changed (tracks added, removed or reordered). */
  setQueue(tracks: Track[]): void {
    const current = this.queue[this.index]
    this.queue = tracks
    this.index = current ? tracks.findIndex((t) => t.id === current.id) : -1
  }

  resume = (): Promise<void> => smtc.send('play', 'tidal')
  pause = (): Promise<void> => smtc.send('pause', 'tidal')
  seek = (positionMs: number): Promise<void> => smtc.send('seek', 'tidal', { positionMs })

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

  // ---- State -----------------------------------------------------------------

  /** Finds the TIDAL track for what's playing: our queue first, then a search. */
  private identify(session: SmtcSession): Track | undefined {
    const queued = this.queue.find((t) => sameTrack(session, t))
    if (queued) return queued
    const key = sessionKey(session)
    if (!this.resolved.has(key) && this.api.catalogAvailable) {
      this.resolved.set(key, null)
      this.api
        .findTrack(session.title, session.artist)
        .then((track) => this.resolved.set(key, track ?? null))
        .catch(() => undefined)
    }
    return this.resolved.get(key) ?? undefined
  }

  watch(onState: (state: PlaybackState | null) => void): () => void {
    return smtc.onSessions(() => {
      const session = smtc.session('tidal')
      const previous = this.lastSession
      this.lastSession = session
      const current = this.queue[this.index]
      const opening = Date.now() < this.openingUntil

      // TIDAL keeps playing its own radio after a deep-linked track ends, so we
      // advance through our queue when the track we started finishes.
      if (!opening && current && previous && session && sameTrack(previous, current) && !sameTrack(session, current)) {
        const nearEnd = previous.durationMs > 0 && previous.positionMs >= previous.durationMs - 5000
        if (nearEnd && this.index + 1 < this.queue.length) void this.open(this.index + 1)
        else if (!nearEnd) this.index = this.queue.findIndex((t) => sameTrack(session, t))
      } else if (!opening && session && (!current || !sameTrack(session, current))) {
        // Started from TIDAL itself or the queue was edited: follow it if it's queued.
        const found = this.queue.findIndex((t) => sameTrack(session, t))
        if (found >= 0) this.index = found
      }

      if (!session || (!session.title && !session.artist)) {
        onState(null)
        return
      }
      const track = this.identify(session)
      onState({
        trackId: track?.id,
        title: session.title,
        artist: session.artist,
        album: session.album || track?.album,
        artworkUrl: session.thumbnail,
        durationMs: session.durationMs,
        positionMs: session.positionMs,
        isPlaying: session.isPlaying,
        liked: track ? this.liked.has(track.id) : undefined
      })
    })
  }
}
