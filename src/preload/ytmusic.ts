import { contextBridge, ipcRenderer } from 'electron'

/**
 * Preload of the hidden music.youtube.com window (macOS audio backend).
 * The page only gets two narrow functions: hand PCM for the visualizer to the
 * main process, and forward media-key/Now Playing next/previous; `ipcRenderer`
 * itself is never exposed.
 */
contextBridge.exposeInMainWorld('__wrBridge', {
  pcm: (rate: number, data: string): void => {
    if (typeof rate === 'number' && typeof data === 'string') ipcRenderer.send('ytmusic:pcm', rate, data)
  },
  media: (action: string): void => {
    if (action === 'next' || action === 'previous') ipcRenderer.send('ytmusic:media', action)
  }
})
