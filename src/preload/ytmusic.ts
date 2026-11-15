import { contextBridge, ipcRenderer } from 'electron'

/**
 * Preload of the hidden music.youtube.com window (macOS audio backend).
 * The page only gets one narrow function to hand PCM for the visualizer to the
 * main process; `ipcRenderer` itself is never exposed.
 */
contextBridge.exposeInMainWorld('__wrBridge', {
  pcm: (rate: number, data: string): void => {
    if (typeof rate === 'number' && typeof data === 'string') ipcRenderer.send('ytmusic:pcm', rate, data)
  }
})
