import { ipcMain, type BrowserWindow } from 'electron'
import type { PlayContext, Playlist, ProviderId } from '@shared/types'
import { settingsStore } from './auth/store'
import { ProviderRegistry } from './providers/registry'

/** Wires the renderer's `window.remote` API to the provider registry. */
export function registerIpc(window: BrowserWindow): ProviderRegistry {
  const send = (channel: string, payload: unknown): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
  const registry = new ProviderRegistry((state) => send('remote:state', state))

  // Every handler reports failures to the UI as well as rejecting the call.
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R): void => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await fn(...(args as A))
      } catch (error) {
        const message = (error as Error).message
        send('remote:error', message)
        throw error
      }
    })
  }

  handle('remote:listProviders', () => registry.list())
  handle('remote:getSettings', () => settingsStore.get())
  handle('remote:selectProvider', (id: ProviderId) => registry.select(id))
  handle('remote:connect', async (id: ProviderId) => {
    await registry.get(id).connect()
    if (registry.active.id === id) registry.restartWatch()
    send('remote:providers', registry.list())
    return registry.info(id)
  })
  handle('remote:disconnect', async (id: ProviderId) => {
    await registry.get(id).disconnect()
    if (registry.active.id === id) registry.restartWatch()
    send('remote:providers', registry.list())
    return registry.info(id)
  })
  handle('remote:setSkin', (url: string | undefined) => {
    settingsStore.update({ skinUrl: url })
  })

  handle('remote:getPlaylists', () => registry.active.getPlaylists())
  handle('remote:getPlaylistTracks', (id: string) => registry.active.getPlaylistTracks(id))
  handle('remote:getLikedTracks', () => registry.active.getLikedTracks())
  handle('remote:search', (query: string) => registry.active.search(query))

  handle('remote:playTrack', (context: PlayContext) => registry.active.playTrack(context))
  handle('remote:playPlaylist', (playlist: Playlist) => registry.active.playPlaylist(playlist))
  handle('remote:resume', () => registry.active.resume())
  handle('remote:pause', () => registry.active.pause())
  handle('remote:next', () => registry.active.next())
  handle('remote:previous', () => registry.active.previous())
  handle('remote:seek', (ms: number) => registry.active.seek(ms))
  handle('remote:setVolume', (volume: number) => registry.active.setVolume(volume))

  ipcMain.on('window:control', (_event, action: 'minimize' | 'close') => {
    if (action === 'minimize') window.minimize()
    else window.close()
  })

  window.webContents.once('did-finish-load', () => registry.restartWatch())
  return registry
}
