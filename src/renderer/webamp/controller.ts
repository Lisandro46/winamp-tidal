import type Webamp from 'webamp'
import type { EqState, EqStatus, PlaybackState, SystemVolume, Track } from '@shared/types'
import { getRemoteMedia, setRemoteMediaHandlers, withoutEcho } from './RemoteMedia'

const TRACK_URL = 'remote://track/'
const NOW_PLAYING_URL = 'remote://now-playing'
const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000] as const
const EQ_DEBOUNCE_MS = 120
/** After the user moves the volume slider, ignore system updates briefly to avoid jitter. */
const VOLUME_HOLD_MS = 600

const ignore = (promise: Promise<unknown>): void => {
  promise.catch(() => undefined) // errors are reported by the main process
}

/**
 * Keeps Webamp and the TIDAL app in sync:
 *  - Webamp UI actions → TIDAL commands, system volume and Equalizer APO
 *  - TIDAL state → Webamp playlist selection, marquee, clock and status
 */
export class RemoteController {
  /** Every TIDAL track ever put in the playlist, by id (the playlist only keeps urls). */
  private known = new Map<string, Track>()
  private queueKey = ''
  private lastState: PlaybackState | null = null
  private volumeArmed = false
  private volumeTouchedAt = 0
  private eqTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly webamp: Webamp,
    private readonly onEqStatus: (status: EqStatus) => void
  ) {
    const remote = window.remote
    setRemoteMediaHandlers({
      play: () => ignore(remote.resume()),
      pause: () => ignore(remote.pause()),
      seek: (ms) => ignore(remote.seek(ms)),
      setVolume: (volume) => {
        if (!this.volumeArmed) return
        this.volumeTouchedAt = performance.now()
        ignore(remote.setVolume(volume))
      },
      eqChanged: () => this.scheduleEqSync(),
      loadTrack: (url, autoPlay) => {
        if (autoPlay) this.playUrl(url)
      }
    })
    this.interceptTransport()
    // Removing, reordering or adding entries in the Winamp playlist edits the queue.
    webamp.store.subscribe(() => this.syncQueue())
  }

  /** The Winamp playlist, in order, as TIDAL tracks. */
  private queue(): Track[] {
    return this.webamp
      .getPlaylistTracks()
      .filter((entry) => entry.url.startsWith(TRACK_URL))
      .map((entry) => this.known.get(entry.url.slice(TRACK_URL.length)))
      .filter((track): track is Track => track != null)
  }

  private syncQueue(): void {
    const urls = this.webamp.getPlaylistTracks().map((entry) => entry.url)
    const key = urls.join('|')
    if (key === this.queueKey) return
    this.queueKey = key
    ignore(window.remote.setQueue(this.queue()))
  }

  // ---- Webamp → TIDAL ----------------------------------------------------------

  /** The TIDAL app (plus our queue) owns playback order, so next/previous go to it. */
  private interceptTransport(): void {
    const remote = window.remote
    window.addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement).closest(
          '#webamp #next, #webamp #previous, #webamp #eject, #webamp #playlist-add-menu'
        )
        if (!button) return
        event.stopPropagation()
        event.preventDefault()
        if (button.id === 'eject') document.dispatchEvent(new CustomEvent('library:toggle'))
        else if (button.id === 'playlist-add-menu') document.dispatchEvent(new CustomEvent('search:open'))
        else ignore(button.id === 'next' ? remote.next() : remote.previous())
      },
      true
    )
    window.addEventListener(
      'keydown',
      (event) => {
        if ((event.target as HTMLElement).closest('input, textarea, #library')) return
        if (event.ctrlKey || event.altKey || event.metaKey) return
        const key = event.key.toLowerCase()
        if (key === 'b' || key === 'z') {
          event.stopPropagation()
          ignore(key === 'b' ? remote.next() : remote.previous())
        } else if (key === 'l' || event.code === 'Numpad0') {
          event.stopPropagation()
          document.dispatchEvent(new CustomEvent('library:toggle'))
        } else if (key === 'j') {
          // Winamp's "Jump to file", here: search TIDAL.
          event.stopPropagation()
          event.preventDefault()
          document.dispatchEvent(new CustomEvent('search:open'))
        }
      },
      true
    )
  }

  private playUrl(url: string): void {
    if (url === NOW_PLAYING_URL) return ignore(window.remote.resume())
    if (!url.startsWith(TRACK_URL)) return
    const tracks = this.queue()
    const index = tracks.findIndex((t) => t.id === url.slice(TRACK_URL.length))
    if (index >= 0) ignore(window.remote.playTrack({ tracks, index }))
  }

  // ---- Library → Webamp playlist -------------------------------------------

  private append(tracks: Track[]): void {
    for (const track of tracks) this.known.set(track.id, track)
    this.webamp.appendTracks(
      tracks.map((track) => ({
        url: TRACK_URL + track.id,
        duration: track.durationMs / 1000,
        metaData: { title: track.title, artist: track.artist, album: track.album }
      }))
    )
  }

  /** Replaces Webamp's playlist with `tracks` (an album, playlist…) and optionally starts one. */
  loadList(tracks: Track[], playIndex?: number): void {
    withoutEcho(() => {
      this.webamp.store.dispatch({ type: 'REMOVE_ALL_TRACKS' })
      this.append(tracks)
    })
    this.syncQueue()
    if (playIndex != null) ignore(window.remote.playTrack({ tracks: this.queue(), index: playIndex }))
    else if (this.lastState) this.applyState(this.lastState)
  }

  /** Adds tracks at the end of the playlist (Winamp's "enqueue"); optionally plays the first. */
  enqueue(tracks: Track[], play = false): void {
    if (!tracks.length) return
    const start = this.queue().length
    withoutEcho(() => this.append(tracks))
    this.syncQueue()
    if (play) ignore(window.remote.playTrack({ tracks: this.queue(), index: start }))
  }

  // ---- TIDAL → Webamp ----------------------------------------------------------

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
      if (webampId != null && store.getState().playlist.currentTrack !== webampId) {
        store.dispatch({ type: 'PLAY_TRACK', id: webampId })
      }
      media?.applyRemote(state.positionMs, state.durationMs, state.isPlaying)
      const status = store.getState().media.status
      if (state.isPlaying && status !== 'PLAYING') store.dispatch({ type: 'IS_PLAYING' })
      if (!state.isPlaying && status === 'PLAYING') store.dispatch({ type: 'PAUSE' })
    })
  }

  applyVolume({ volume }: SystemVolume): void {
    this.volumeArmed = true
    if (performance.now() - this.volumeTouchedAt < VOLUME_HOLD_MS) return
    if (Math.abs(this.webamp.store.getState().media.volume - volume) < 1) return
    withoutEcho(() => this.webamp.store.dispatch({ type: 'SET_VOLUME', volume }))
  }

  /**
   * Returns the Webamp playlist id that represents what TIDAL is playing.
   * If it's not in the loaded list, a single "now playing" entry is used instead.
   */
  private ensureCurrentTrack(state: PlaybackState): number | null {
    const entries = this.webamp.getPlaylistTracks()
    if (state.trackId) {
      const match = entries.find((e) => e.url === TRACK_URL + state.trackId)
      if (match) {
        // A "now playing" entry left from before the track started isn't needed anymore.
        const stale = entries.find((e) => e.url === NOW_PLAYING_URL)
        if (stale) this.webamp.store.dispatch({ type: 'REMOVE_TRACKS', ids: [stale.id] })
        return match.id
      }
    }

    const metaData = { title: state.title, artist: state.artist, album: state.album }
    let nowPlaying = entries.find((e) => e.url === NOW_PLAYING_URL)
    if (!nowPlaying) {
      this.webamp.appendTracks([{ url: NOW_PLAYING_URL, duration: state.durationMs / 1000, metaData }])
      nowPlaying = this.webamp.getPlaylistTracks().find((e) => e.url === NOW_PLAYING_URL)
      if (!nowPlaying) return null
    }
    if (nowPlaying.title !== state.title || nowPlaying.artist !== state.artist) {
      this.webamp.store.dispatch({
        type: 'SET_MEDIA_TAGS',
        id: nowPlaying.id,
        ...metaData,
        sampleRate: 44000,
        bitrate: 320000,
        numberOfChannels: 2
      })
      this.webamp.store.dispatch({ type: 'SET_MEDIA_DURATION', id: nowPlaying.id, duration: state.durationMs / 1000 })
    }
    return nowPlaying.id
  }

  // ---- Equalizer ---------------------------------------------------------------

  private readEq(): EqState {
    const { on, sliders } = this.webamp.store.getState().equalizer
    return { on, preamp: sliders.preamp, bands: EQ_BANDS.map((band) => sliders[band]) }
  }

  private scheduleEqSync(): void {
    clearTimeout(this.eqTimer)
    this.eqTimer = setTimeout(
      () => ignore(window.remote.setEq(this.readEq()).then(this.onEqStatus)),
      EQ_DEBOUNCE_MS
    )
  }

  /** Puts saved EQ values back on the sliders and applies them once. */
  restoreEq(saved: EqState | undefined): void {
    if (saved) {
      const store = this.webamp.store
      withoutEcho(() => {
        store.dispatch({ type: 'SET_BAND_VALUE', band: 'preamp', value: saved.preamp })
        EQ_BANDS.forEach((band, i) => store.dispatch({ type: 'SET_BAND_VALUE', band, value: saved.bands[i] ?? 50 }))
        store.dispatch({ type: saved.on ? 'SET_EQ_ON' : 'SET_EQ_OFF' })
      })
    }
    this.scheduleEqSync()
  }
}
