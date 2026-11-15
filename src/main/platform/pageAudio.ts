import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { ipcMain, type IpcMainEvent, type WebContents } from 'electron'
import type { PcmChunk } from '@shared/types'
import { EQ_BANDS } from '../audio/equalizer'

/** Sample rate of the PCM sent to the visualizer (same as the Windows helper). */
const PCM_RATE = 24000
const PCM_INTERVAL_MS = 40
/** Generous cap for one ~40 ms chunk of base64 int16 at 24 kHz (~2.6 KB). */
const MAX_PCM_BASE64 = 64 * 1024

/** dB values pushed into the page graph. */
export interface PageEq {
  preamp: number
  gains: number[]
}

/**
 * Runs in the main world of music.youtube.com. Installs `window.__wr` once:
 *   <video> → MediaElementSource → 10× peaking BiquadFilter → preamp Gain → volume Gain → Analyser → destination
 * A MutationObserver attaches new <video> elements if YouTube replaces the player's.
 * While PCM is on, the analyser is read every ~40 ms and the new samples are sent,
 * as mono int16 at 24 kHz in base64, through the preload's `__wrBridge.pcm`.
 */
const GRAPH_SCRIPT = `(() => {
  if (location.hostname !== 'music.youtube.com') return false
  if (window.__wr) { window.__wr.scan(); return true }
  const BANDS = ${JSON.stringify(EQ_BANDS)}
  const RATE = ${PCM_RATE}
  const ctx = new AudioContext({ latencyHint: 'playback' })
  const filters = BANDS.map((hz) => {
    const f = ctx.createBiquadFilter()
    f.type = 'peaking'
    f.frequency.value = hz
    f.Q.value = 1.4
    f.gain.value = 0
    return f
  })
  const preamp = ctx.createGain()
  const volume = ctx.createGain()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 8192
  analyser.smoothingTimeConstant = 0
  for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1])
  filters[filters.length - 1].connect(preamp)
  preamp.connect(volume)
  volume.connect(analyser)
  analyser.connect(ctx.destination)

  const attached = new WeakSet()
  const resume = () => { if (ctx.state !== 'running') ctx.resume().catch(() => {}) }
  const attach = (video) => {
    if (attached.has(video)) return
    attached.add(video)
    try {
      ctx.createMediaElementSource(video).connect(filters[0])
    } catch (e) {
      console.warn('[winamp-remote] could not attach audio graph', e)
      return
    }
    video.addEventListener('play', resume)
    video.addEventListener('playing', resume)
    resume()
  }
  const scan = () => document.querySelectorAll('video').forEach(attach)
  // YouTube mutates the DOM constantly: coalesce the rescans.
  let scanTimer = 0
  new MutationObserver(() => {
    if (!scanTimer) scanTimer = setTimeout(() => { scanTimer = 0; scan() }, 250)
  }).observe(document.documentElement, { childList: true, subtree: true })
  scan()

  const dbToGain = (db) => Math.pow(10, db / 20)
  const buffer = new Float32Array(analyser.fftSize)
  let pcmTimer = 0
  let lastRead = 0
  const readPcm = () => {
    const bridge = window.__wrBridge
    if (!bridge || ctx.state !== 'running') { lastRead = performance.now(); return }
    const now = performance.now()
    const fresh = Math.min(buffer.length, Math.round(((now - lastRead) / 1000) * ctx.sampleRate))
    lastRead = now
    if (fresh <= 0) return
    analyser.getFloatTimeDomainData(buffer)
    const start = buffer.length - fresh
    const step = ctx.sampleRate / RATE
    const out = new Int16Array(Math.floor(fresh / step))
    for (let i = 0; i < out.length; i++) {
      const at = start + i * step
      const i0 = Math.floor(at)
      const i1 = Math.min(i0 + 1, buffer.length - 1)
      const s = buffer[i0] + (buffer[i1] - buffer[i0]) * (at - i0)
      out[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)))
    }
    if (!out.length) return
    const bytes = new Uint8Array(out.buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    }
    bridge.pcm(RATE, btoa(binary))
  }

  window.__wr = {
    scan,
    setVolume(value) {
      const v = Math.max(0, Math.min(100, Number(value) || 0)) / 100
      volume.gain.setTargetAtTime(v * v, ctx.currentTime, 0.02)
    },
    setEq(state) {
      filters.forEach((f, i) => f.gain.setTargetAtTime((state && state.gains[i]) || 0, ctx.currentTime, 0.02))
      preamp.gain.setTargetAtTime(dbToGain((state && state.preamp) || 0), ctx.currentTime, 0.02)
    },
    setPcm(enabled) {
      clearInterval(pcmTimer)
      pcmTimer = 0
      if (enabled) {
        lastRead = performance.now()
        pcmTimer = setInterval(readPcm, ${PCM_INTERVAL_MS})
      }
    }
  }
  return true
})()`

/**
 * Bridge between the main process and the Web Audio graph injected into the
 * hidden YouTube Music window (macOS backend). Keeps the last volume/EQ/PCM
 * state and re-applies it whenever the graph is (re)installed, e.g. after a reload.
 * Disabled (no preload, no injection) unless a backend calls `enable()`.
 */
class PageAudio extends EventEmitter {
  private enabled = false
  private contents: WebContents | undefined
  private volume = 100
  private eq: PageEq = { preamp: 0, gains: EQ_BANDS.map(() => 0) }
  private pcm = false

  constructor() {
    super()
    ipcMain.on('ytmusic:pcm', (event: IpcMainEvent, rate: unknown, data: unknown) => {
      if (event.sender !== this.contents) return
      if (typeof rate !== 'number' || typeof data !== 'string' || data.length > MAX_PCM_BASE64) return
      this.emit('pcm', { rate, data } satisfies PcmChunk)
    })
  }

  enable(): void {
    this.enabled = true
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /** Preload for the YouTube Music window, when the page graph is in use. */
  preload(): string | undefined {
    return this.enabled ? join(__dirname, '../preload/ytmusic.js') : undefined
  }

  /** Tracks the YouTube Music window: the graph is (re)installed on every page load. */
  attach(contents: WebContents): void {
    if (!this.enabled || this.contents === contents) return
    this.contents = contents
    contents.on('did-finish-load', () => void this.inject())
    contents.once('destroyed', () => {
      if (this.contents === contents) this.contents = undefined
    })
  }

  /** Installs the graph (idempotent) and pushes the current state into it. */
  async inject(): Promise<void> {
    const contents = this.contents
    if (!this.enabled || !contents || contents.isDestroyed()) return
    try {
      const installed = await contents.executeJavaScript(GRAPH_SCRIPT, true)
      if (installed) await this.push()
    } catch (error) {
      console.warn('[pageAudio] inject failed', error)
    }
  }

  private async push(): Promise<void> {
    await this.call(`setVolume(${this.volume})`)
    await this.call(`setEq(${JSON.stringify(this.eq)})`)
    await this.call(`setPcm(${this.pcm})`)
  }

  private async call(expression: string): Promise<void> {
    const contents = this.contents
    if (!contents || contents.isDestroyed()) return
    await contents.executeJavaScript(`window.__wr && window.__wr.${expression}`, true).catch(() => undefined)
  }

  getVolume(): number {
    return this.volume
  }

  async setVolume(volume: number): Promise<void> {
    this.volume = Math.max(0, Math.min(100, Math.round(volume)))
    await this.call(`setVolume(${this.volume})`)
  }

  async setEq(eq: PageEq): Promise<void> {
    this.eq = eq
    await this.call(`setEq(${JSON.stringify(eq)})`)
  }

  async setPcm(enabled: boolean): Promise<void> {
    this.pcm = enabled
    await this.call(`setPcm(${enabled})`)
  }
}

export const pageAudio = new PageAudio()
