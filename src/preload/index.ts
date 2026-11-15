import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { RemoteApi } from '@shared/types'

const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(`remote:${channel}`, ...args)

const subscribe =
  <T>(channel: string) =>
  (callback: (payload: T) => void) => {
    const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
    ipcRenderer.on(`remote:${channel}`, listener)
    return () => {
      ipcRenderer.off(`remote:${channel}`, listener)
    }
  }

const methods = [
  'getAuth',
  'getAccounts',
  'selectAccount',
  'connect',
  'cancelLogin',
  'disconnect',
  'getCredentials',
  'setCredentials',
  'getSettings',
  'setProvider',
  'importYouTubeSession',
  'setSkin',
  'searchSkins',
  'getLikedTracks',
  'getPlaylists',
  'getMixes',
  'getAlbums',
  'getArtists',
  'getTracks',
  'search',
  'setLiked',
  'getLikedIds',
  'playTrack',
  'setQueue',
  'setPlayMode',
  'startRadio',
  'resume',
  'pause',
  'next',
  'previous',
  'seek',
  'setVolume',
  'getEq',
  'setEq',
  'ready',
  'openVisualizer'
] as const

const events = { onState: 'state', onVolume: 'volume', onPcm: 'pcm', onLiked: 'liked', onError: 'error', onQueueAdd: 'queueAdd', onProvider: 'provider', onLoginStatus: 'loginStatus' } as const

const api = {
  platform: process.platform,
  ...Object.fromEntries(methods.map((name) => [name, invoke(name)])),
  ...Object.fromEntries(Object.entries(events).map(([name, channel]) => [name, subscribe(channel)])),
  windowControl: (action: 'minimize' | 'close') => ipcRenderer.send('window:control', action),
  setInteractive: (interactive: boolean) => ipcRenderer.send('window:interactive', interactive),
  dragWindow: (action: 'start' | 'end') => ipcRenderer.send('window:drag', action),
  fitWindow: (width: number, height: number) => ipcRenderer.send('window:fit', width, height),
  scaleWindow: (direction: 'in' | 'out' | 'reset') => ipcRenderer.send('window:scale', direction),
  getLayout: () => ipcRenderer.invoke('window:layout'),
  onLayout: (callback: (layout: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, layout: unknown): void => callback(layout)
    ipcRenderer.on('window:layout', listener)
    return () => {
      ipcRenderer.off('window:layout', listener)
    }
  }
} as unknown as RemoteApi

contextBridge.exposeInMainWorld('remote', api)
