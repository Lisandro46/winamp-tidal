/**
 * Replacement for Webamp's audio engine (passed as `__customMediaClass`).
 *
 * Instead of playing audio it forwards transport commands to a remote player
 * (Spotify / TIDAL / Windows media session) and reports the remote position
 * back so the skin's clock, seek bar and play state stay in sync.
 */

export interface RemoteMediaHandlers {
  play(): void
  pause(): void
  seek(positionMs: number): void
  setVolume(volume: number): void
  /** Webamp asked to start a playlist entry (double click, Webamp-driven next/prev, …). */
  loadTrack(url: string, autoPlay: boolean): void
}

type Listener = () => void

const VOLUME_DEBOUNCE_MS = 250

let handlers: RemoteMediaHandlers | undefined
let instance: RemoteMedia | undefined
/** While true, Webamp state changes come from the remote and must not be echoed back. */
let syncing = false

export function setRemoteMediaHandlers(next: RemoteMediaHandlers): void {
  handlers = next
}

export function getRemoteMedia(): RemoteMedia | undefined {
  return instance
}

/** Runs `fn` without forwarding the resulting Webamp actions to the remote. */
export function withoutEcho(fn: () => void): void {
  const previous = syncing
  syncing = true
  try {
    fn()
  } finally {
    syncing = previous
  }
}

export class RemoteMedia {
  private listeners = new Map<string, Listener[]>()
  private positionMs = 0
  private durationMs = 0
  private playing = false
  private updatedAt = performance.now()
  private volumeTimer: ReturnType<typeof setTimeout> | undefined
  private clock: ReturnType<typeof setInterval>

  private context = new AudioContext()
  private analyser = this.context.createAnalyser()
  private visualizerGain = this.context.createGain()

  constructor() {
    instance = this
    // We can't tap the remote audio, so the visualizer is driven by quiet noise
    // that only "plays" while the remote is playing. It never reaches the speakers.
    const noise = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate)
    const samples = noise.getChannelData(0)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = (Math.random() * 2 - 1) * (0.4 + 0.6 * Math.abs(Math.sin(i / 2400)))
    }
    const source = this.context.createBufferSource()
    source.buffer = noise
    source.loop = true
    this.visualizerGain.gain.value = 0
    source.connect(this.visualizerGain).connect(this.analyser)
    source.start()

    this.clock = setInterval(() => {
      if (this.playing) this.trigger('timeupdate')
    }, 250)
  }

  // ---- Called by the controller with remote state -------------------------

  applyRemote(positionMs: number, durationMs: number, playing: boolean): void {
    const durationChanged = Math.abs(durationMs - this.durationMs) > 1000
    this.positionMs = positionMs
    this.durationMs = durationMs
    this.updatedAt = performance.now()
    if (playing !== this.playing) {
      this.playing = playing
      this.visualizerGain.gain.value = playing ? 1 : 0
      if (playing) {
        void this.context.resume()
        this.trigger('playing')
      }
    }
    if (durationChanged) this.trigger('fileLoaded')
    this.trigger('timeupdate')
  }

  // ---- IMedia ------------------------------------------------------------

  on(event: string, callback: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), callback])
  }

  private trigger(event: string): void {
    this.listeners.get(event)?.forEach((callback) => callback())
  }

  timeElapsed(): number {
    const drift = this.playing ? performance.now() - this.updatedAt : 0
    return Math.min(this.positionMs + drift, this.durationMs || Infinity) / 1000
  }

  duration(): number {
    return this.durationMs / 1000
  }

  async play(): Promise<void> {
    if (!syncing) handlers?.play()
  }

  pause(): void {
    if (!syncing) handlers?.pause()
  }

  stop(): void {
    if (!syncing) handlers?.pause()
  }

  seekToPercentComplete(percent: number): void {
    const positionMs = (percent / 100) * this.durationMs
    this.positionMs = positionMs
    this.updatedAt = performance.now()
    if (!syncing) handlers?.seek(positionMs)
  }

  setVolume(volume: number): void {
    if (syncing) return
    clearTimeout(this.volumeTimer)
    this.volumeTimer = setTimeout(() => handlers?.setVolume(volume), VOLUME_DEBOUNCE_MS)
  }

  async loadFromUrl(url: string, autoPlay: boolean): Promise<void> {
    if (!syncing) handlers?.loadTrack(url, autoPlay)
  }

  getAnalyser(): AnalyserNode {
    return this.analyser
  }

  // Balance, preamp and EQ can't be applied to a remote player.
  setBalance(): void {}
  setPreamp(): void {}
  setEqBand(): void {}
  disableEq(): void {}
  enableEq(): void {}

  dispose(): void {
    clearInterval(this.clock)
    void this.context.close()
    this.listeners.clear()
  }
}
