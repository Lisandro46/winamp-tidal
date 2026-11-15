import type { EqState, EqStatus, PcmChunk, SystemVolume } from '@shared/types'

/** Native audio services the app needs from the host platform (volume, PCM tap for the visualizer). */
export interface AudioBackend {
  start(): void
  stop(): void
  setVolume(volume: number): Promise<void>
  onVolume(listener: (volume: SystemVolume) => void): () => void
  onPcm(listener: (chunk: PcmChunk) => void): () => void
  setVisualizer(enabled: boolean): Promise<void>
}

/** Equalizer applied to the system/app audio. */
export interface EqBackend {
  status(): Promise<EqStatus>
  apply(state: EqState): Promise<EqStatus>
}

export interface PlatformBackend {
  audio: AudioBackend
  eq: EqBackend
}
