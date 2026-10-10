/**
 * Replacement for Webamp's audio engine (passed as `__customMediaClass`).
 *
 * Instead of playing audio it forwards transport commands to the TIDAL app,
 * reports TIDAL's position back so the skin's clock and seek bar stay in sync,
 * and feeds the visualizer with the real system audio captured by the helper.
 */

import type { PcmChunk } from '@shared/types'

export interface RemoteMediaHandlers {
  play(): void
  pause(): void
  seek(positionMs: number): void
  setVolume(volume: number): void
  /** Any EQ slider, preamp or on/off change; the controller reads the store. */
  eqChanged(): void
  /** Webamp asked to start a playlist entry (double click, Webamp-driven next/prev, …). */
  loadTrack(url: string, autoPlay: boolean): void
}

type Listener = () => void

const VOLUME_DEBOUNCE_MS = 60
/** Small buffer so captured audio chunks play back-to-back without gaps. */
const PCM_LATENCY_S = 0.05

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
  private nextPcmTime = 0

  constructor() {
    instance = this
    this.clock = setInterval(() => {
      if (this.playing) this.trigger('timeupdate')
    }, 250)
  }

  // ---- Called by the controller ----------------------------------------------

  applyRemote(positionMs: number, durationMs: number, playing: boolean): void {
    const durationChanged = Math.abs(durationMs - this.durationMs) > 1000
    this.positionMs = positionMs
    this.durationMs = durationMs
    this.updatedAt = performance.now()
    if (playing !== this.playing) {
      this.playing = playing
      if (playing) this.trigger('playing')
    }
    if (durationChanged) this.trigger('fileLoaded')
    this.trigger('timeupdate')
  }

  /**
   * Plays captured system audio into the analyser only (never to the speakers),
   * so Webamp's spectrum and oscilloscope react to what TIDAL is playing.
   */
  feedPcm({ rate, data }: PcmChunk): void {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const samples = new Int16Array(bytes.buffer, 0, bytes.length >> 1)
    if (!samples.length) return
    const buffer = this.context.createBuffer(1, samples.length, rate)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768

    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(this.analyser)
    const now = this.context.currentTime
    // Resync when we fell behind (e.g. the window was hidden).
    if (this.nextPcmTime < now || this.nextPcmTime > now + 0.5) this.nextPcmTime = now + PCM_LATENCY_S
    source.start(this.nextPcmTime)
    this.nextPcmTime += buffer.duration
  }

  // ---- IMedia ----------------------------------------------------------------

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
    void this.context.resume()
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

  // The equalizer is applied system-wide by Equalizer APO; balance can't be.
  setPreamp(): void {
    if (!syncing) handlers?.eqChanged()
  }
  setEqBand(): void {
    if (!syncing) handlers?.eqChanged()
  }
  enableEq(): void {
    if (!syncing) handlers?.eqChanged()
  }
  disableEq(): void {
    if (!syncing) handlers?.eqChanged()
  }
  setBalance(): void {}

  dispose(): void {
    clearInterval(this.clock)
    void this.context.close()
    this.listeners.clear()
  }
}
