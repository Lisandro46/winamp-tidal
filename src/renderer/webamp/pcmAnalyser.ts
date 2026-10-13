import type { PcmChunk } from '@shared/types'

/** Small buffer so captured audio chunks play back-to-back without gaps. */
const PCM_LATENCY_S = 0.05

/**
 * Plays captured system audio into an analyser only (never to the speakers),
 * so visualizers react to what the music service is playing.
 */
export class PcmAnalyser {
  readonly context = new AudioContext()
  readonly analyser = this.context.createAnalyser()
  private nextTime = 0

  feed({ rate, data }: PcmChunk): void {
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
    if (this.nextTime < now || this.nextTime > now + 0.5) this.nextTime = now + PCM_LATENCY_S
    source.start(this.nextTime)
    this.nextTime += buffer.duration
  }

  resume(): void {
    void this.context.resume()
  }

  close(): void {
    void this.context.close()
  }
}
