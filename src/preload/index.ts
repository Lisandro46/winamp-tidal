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

const api: RemoteApi = {
  listProviders: invoke('listProviders'),
  getSettings: invoke('getSettings'),
  selectProvider: invoke('selectProvider'),
  connect: invoke('connect'),
  disconnect: invoke('disconnect'),
  setSkin: invoke('setSkin'),
  getPlaylists: invoke('getPlaylists'),
  getPlaylistTracks: invoke('getPlaylistTracks'),
  getLikedTracks: invoke('getLikedTracks'),
  search: invoke('search'),
  playTrack: invoke('playTrack'),
  playPlaylist: invoke('playPlaylist'),
  resume: invoke('resume'),
  pause: invoke('pause'),
  next: invoke('next'),
  previous: invoke('previous'),
  seek: invoke('seek'),
  setVolume: invoke('setVolume'),
  onState: subscribe('state'),
  onError: subscribe('error'),
  onProviders: subscribe('providers'),
  windowControl: (action) => ipcRenderer.send('window:control', action)
} as RemoteApi

contextBridge.exposeInMainWorld('remote', api)
