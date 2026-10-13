// Butterchurn ships without type declarations; only what the visualizer window uses.

declare module 'butterchurn' {
  export interface Visualizer {
    connectAudio(node: AudioNode): void
    loadPreset(preset: object, blendTime: number): void
    setRendererSize(width: number, height: number): void
    launchSongTitleAnim(title: string): void
    render(): void
  }
  const butterchurn: {
    createVisualizer(
      context: AudioContext,
      canvas: HTMLCanvasElement,
      options: {
        width: number
        height: number
        pixelRatio?: number
        meshWidth?: number
        meshHeight?: number
        onlyUseWASM?: boolean
      }
    ): Visualizer
  }
  export default butterchurn
}

declare module 'butterchurn-presets' {
  /** Preset name → Butterchurn preset object. */
  const presets: Record<string, object>
  export default presets
}

// webamp 2.3.1 points this entry at a missing .d.ts; it is Webamp plus Milkdrop.
declare module 'webamp/butterchurn' {
  import Webamp from 'webamp'
  export default Webamp
}
