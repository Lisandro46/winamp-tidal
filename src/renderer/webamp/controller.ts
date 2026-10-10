import type Webamp from 'webamp'
import type { PlayContext, PlaybackState, Playlist, Track } from '@shared/types'
import { getRemoteMedia, setRemoteMediaHandlers, withoutEcho } from './RemoteMedia'

const TRACK_URL = 'remote://track/'
const NOW_PLAYING_URL = 'remote://now-playing'

interface LoadedList {
  tracks: Track[]
  playlist?: Playlist
}

/**
 * Keeps Webamp and the remote player in sync:
 *  - Webamp UI actions → remote commands (via RemoteMedia handlers and DOM interception)
 *  - remote PlaybackState → Webamp playlist selection, marquee, clock and status
 */
export class RemoteController {
  private list: LoadedList = { tracks: [] }
  private lastState: PlaybackState | null = null
  private volumeArmed = false

  constructor(private readonly webamp: Webamp) {
    const remote = window.remote
    const run = (promise: Promise<unknown>): void => {
      promise.catch(() => undefined) // errors are reported by the main process
    }

    setRemoteMediaHandlers({
      play: () => run(remote.resume()),
      pause: () => run(remote.pause()),
      seek: (ms) => run(remote.seek(ms)),
      setVolume: (volume) => {
        if (this.volumeArmed) run(remote.setVolume(volume))
      },
      loadTrack: (url, autoPlay) => {
        if (autoPlay) this.playUrl(url)
      }
    })
    this.interceptTransport()
  }

  // ---- Webamp → remote ---------------------------------------------------

  /** The remote owns the queue, so next/previous go straight to it. */
  private interceptTransport(): void {
    const remote = window.remote
    const commands: Record<string, () => Promise<void>> = {
      next: () => remote.next(),
      previous: () => remote.previous()
    }
    window.addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement).closest('#webamp #next, #webamp #previous, #webamp #eject')
        if (!button) return
        event.stopPropagation()
        event.preventDefault()
        if (button.id === 'eject') document.dispatchEvent(new CustomEvent('library:toggle'))
        else void commands[button.id]().catch(() => undefined)
      },
      true
    )
    window.addEventListener(
      'keydown',
      (event) => {
        if ((event.target as HTMLElement).closest('input, textarea, #library')) return
        const key = event.key.toLowerCase()
        if (event.ctrlKey || event.altKey || event.metaKey) return
        if (key === 'b' || key === 'z') {
          event.stopPropagation()
          void (key === 'b' ? remote.next() : remote.previous()).catch(() => undefined)
        } else if (key === 'l' || event.code === 'Numpad0') {
          event.stopPropagation()
          document.dispatchEvent(new CustomEvent('library:toggle'))
        }
      },
      true
    )
  }

  private playUrl(url: string): void {
    if (!url.startsWith(TRACK_URL)) {
      if (url === NOW_PLAYING_URL) void window.remote.resume().catch(() => undefined)
      return
    }
    const id = url.slice(TRACK_URL.length)
    const index = this.list.tracks.findIndex((t) => t.id === id)
    if (index < 0) return
    void this.playIndex(index)
  }

  private async playIndex(index: number): Promise<void> {
    const context: PlayContext = { tracks: this.list.tracks, index, playlist: this.list.playlist }
    await window.remote.playTrack(context).catch(() => undefined)
  }

  // ---- Library → Webamp playlist -------------------------------------------

  /** Replaces Webamp's playlist with `tracks` (and optionally starts one). */
  loadList(tracks: Track[], playlist?: Playlist, playIndex?: number): void {
    this.list = { tracks, playlist }
    withoutEcho(() => {
      this.webamp.store.dispatch({ type: 'REMOVE_ALL_TRACKS' })
      this.webamp.appendTracks(
        tracks.map((track) => ({
          url: TRACK_URL + track.id,
          duration: track.durationMs / 1000,
          metaData: { title: track.title, artist: track.artist, album: track.album }
        }))
      )
    })
    if (playIndex != null) void this.playIndex(playIndex)
    else if (this.lastState) this.applyState(this.lastState)
  }

  clearList(): void {
    this.loadList([])
  }

  // ---- remote → Webamp ---------------------------------------------------

  applyState(state: PlaybackState | null): void {
    this.lastState = state
    const media = getRemoteMedia()
    const store = this.webamp.store
    if (!state) {
      media?.applyRemote(0, 0, false)
      withoutEcho(() => store.dispatch({ type: 'PAUSE' }))
      return
    }

    withoutEcho(() => {
      const webampId = this.ensureCurrentTrack(state)
      const current = store.getState().playlist.currentTrack
      if (webampId != null && current !== webampId) {
        store.dispatch({ type: 'PLAY_TRACK', id: webampId })
      }

      media?.applyRemote(state.positionMs, state.durationMs, state.isPlaying)
      const status = store.getState().media.status
      if (state.isPlaying && status !== 'PLAYING') store.dispatch({ type: 'IS_PLAYING' })
      if (!state.isPlaying && status === 'PLAYING') store.dispatch({ type: 'PAUSE' })

      if (state.volume != null && Math.abs(store.getState().media.volume - state.volume) > 1) {
        store.dispatch({ type: 'SET_VOLUME', volume: state.volume })
      }
    })
    this.volumeArmed = true
  }

  /**
   * Returns the Webamp playlist id that represents what the remote is playing.
   * If it's not in the loaded list, a single "now playing" entry is used instead.
   */
  private ensureCurrentTrack(state: PlaybackState): number | null {
    const entries = this.webamp.getPlaylistTracks() as { id: number; url: string }[]
    if (state.trackId) {
      const match = entries.find((e) => e.url === TRACK_URL + state.trackId)
      if (match) return match.id
    }

    const metaData = { title: state.title, artist: state.artist, album: state.album }
    let nowPlaying = entries.find((e) => e.url === NOW_PLAYING_URL)
    if (!nowPlaying) {
      this.webamp.appendTracks([{ url: NOW_PLAYING_URL, duration: state.durationMs / 1000, metaData }])
      nowPlaying = (this.webamp.getPlaylistTracks() as { id: number; url: string }[]).find(
        (e) => e.url === NOW_PLAYING_URL
      )
      if (!nowPlaying) return null
    }
    this.webamp.store.dispatch({
      type: 'SET_MEDIA_TAGS',
      id: nowPlaying.id,
      ...metaData,
      sampleRate: 44000,
      bitrate: 320000,
      numberOfChannels: 2
    })
    this.webamp.store.dispatch({ type: 'SET_MEDIA_DURATION', id: nowPlaying.id, duration: state.durationMs / 1000 })
    return nowPlaying.id
  }
}
