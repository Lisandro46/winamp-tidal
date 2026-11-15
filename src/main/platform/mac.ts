import { EventEmitter } from 'node:events'
import type { EqState, EqStatus, PcmChunk, SystemVolume } from '@shared/types'
import { settingsStore } from '../auth/store'
import { EQ_BANDS, eqToDb } from '../audio/equalizer'
import { pageAudio, type PageEq } from './pageAudio'
import type { AudioBackend, EqBackend, PlatformBackend } from './types'

const DEVICE = 'YouTube Music'

/** Same slider→dB conversion as Equalizer APO on Windows (±12 dB, preamp with headroom). */
function toPageEq(state: EqState | undefined): PageEq {
  if (!state || !state.on) return { preamp: 0, gains: EQ_BANDS.map(() => 0) }
  return eqToDb(state)
}

/**
 * macOS audio: music plays inside the hidden YouTube Music window, so volume and
 * the visualizer's PCM come from the Web Audio graph injected there (see pageAudio).
 * The reported volume is the graph's gain, not the system volume.
 */
class MacAudio extends EventEmitter implements AudioBackend {
  constructor() {
    super()
    pageAudio.on('pcm', (chunk: PcmChunk) => this.emit('pcm', chunk))
  }

  private current(): SystemVolume {
    return { volume: pageAudio.getVolume(), muted: false, device: DEVICE }
  }

  start(): void {}
  stop(): void {}

  async setVolume(volume: number): Promise<void> {
    await pageAudio.setVolume(volume)
    this.emit('volume', this.current())
  }

  onVolume(listener: (volume: SystemVolume) => void): () => void {
    this.on('volume', listener)
    listener(this.current())
    return () => this.off('volume', listener)
  }

  onPcm(listener: (chunk: PcmChunk) => void): () => void {
    this.on('pcm', listener)
    return () => this.off('pcm', listener)
  }

  setVisualizer(enabled: boolean): Promise<void> {
    return pageAudio.setPcm(enabled)
  }
}

/** 10-band EQ done by the page's BiquadFilters: always available, nothing to install. */
class MacEqualizer implements EqBackend {
  async status(): Promise<EqStatus> {
    return { installed: true }
  }

  async apply(state: EqState): Promise<EqStatus> {
    await pageAudio.setEq(toPageEq(state))
    return this.status()
  }
}

export function createMacBackend(): PlatformBackend {
  pageAudio.enable()
  // The page graph starts with the last saved EQ (also re-applied on every (re)injection).
  void pageAudio.setEq(toPageEq(settingsStore.get().eq))
  return { audio: new MacAudio(), eq: new MacEqualizer() }
}
