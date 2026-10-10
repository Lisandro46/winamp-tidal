import { ipcMain, type BrowserWindow } from 'electron'
import type { AuthInfo, Collection, EqState, PlayContext, TidalCredentials, Track } from '@shared/types'
import { settingsStore } from './auth/store'
import { Equalizer } from './audio/equalizer'
import { smtc } from './smtc/helperClient'
import { TidalApi } from './tidal/api'
import { TidalPlayer } from './tidal/player'

/** Wires the renderer's `window.remote` API to TIDAL, the Windows helper and the equalizer. */
export function registerIpc(window: BrowserWindow): () => void {
  const send = (channel: string, payload: unknown): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
  const api = new TidalApi()
  const player = new TidalPlayer(api, (ids) => send('remote:liked', ids))
  const equalizer = new Equalizer()

  const auth = (): AuthInfo => ({
    configured: api.configured,
    connected: api.connected,
    catalog: api.catalogAvailable,
    hint: api.configured ? undefined : 'Solo control remoto'
  })

  // Every handler reports failures to the UI as well as rejecting the call.
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R): void => {
    ipcMain.handle(`remote:${channel}`, async (_event, ...args) => {
      try {
        return await fn(...(args as A))
      } catch (error) {
        send('remote:error', (error as Error).message)
        throw error
      }
    })
  }
  // User library calls need a login; catalog calls also work with the app token.
  const library =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      await api.ensureUser()
      return fn(...args)
    }
  const catalog =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      await api.ensureCatalog()
      return fn(...args)
    }

  handle('getAuth', auth)
  handle('connect', async () => {
    await api.login()
    await player.loadLiked()
    return auth()
  })
  handle('disconnect', async () => {
    api.logout()
    await player.loadLiked()
    return auth()
  })
  handle('getCredentials', () => api.credentialsInfo())
  handle('setCredentials', async (credentials: TidalCredentials | null) => {
    await api.setCredentials(credentials)
    settingsStore.update({ setupDone: true })
    await player.loadLiked().catch(() => undefined)
    return auth()
  })
  handle('getSettings', () => settingsStore.get())
  handle('setSkin', (url: string | undefined) => {
    settingsStore.update({ skinUrl: url })
  })

  handle('getLikedTracks', library(() => api.likedTracks()))
  handle('getPlaylists', library(() => api.userPlaylists()))
  handle('getMixes', library(() => api.mixes()))
  handle('getAlbums', library(() => api.userAlbums()))
  handle('getArtists', library(() => api.userArtists()))
  handle('getTracks', catalog((collection: Collection) => api.collectionTracks(collection)))
  handle('search', catalog((query: string) => api.search(query)))
  handle('setLiked', library((id: string, liked: boolean) => player.setLiked(id, liked)))
  handle('getLikedIds', () => player.likedIds())

  handle('playTrack', (context: PlayContext) => player.playTrack(context))
  handle('setQueue', (tracks: Track[]) => player.setQueue(tracks))
  handle('resume', () => player.resume())
  handle('pause', () => player.pause())
  handle('next', () => player.next())
  handle('previous', () => player.previous())
  handle('seek', (ms: number) => player.seek(ms))

  handle('setVolume', (volume: number) => smtc.setVolume(volume))
  handle('getEq', () => equalizer.status())
  handle('setEq', async (state: EqState) => {
    settingsStore.update({ eq: state })
    return equalizer.apply(state)
  })

  ipcMain.on('window:control', (_event, action: 'minimize' | 'close') => {
    if (action === 'minimize') window.minimize()
    else window.close()
  })

  // The visualizer only needs audio while the window can be seen.
  const visualizer = (on: boolean): void => void smtc.setVisualizer(on).catch(() => undefined)
  window.on('minimize', () => visualizer(false))
  window.on('restore', () => visualizer(true))

  // The renderer calls `ready` once its listeners exist (also after a reload),
  // so the first state/volume messages are never lost.
  let stops: (() => void)[] = []
  const stopAll = (): void => {
    stops.forEach((stop) => stop())
    stops = []
  }
  handle('ready', () => {
    stopAll()
    stops.push(
      player.watch((state) => send('remote:state', state)),
      smtc.onVolume((volume) => send('remote:volume', volume)),
      smtc.onPcm((chunk) => send('remote:pcm', chunk))
    )
    visualizer(true)
    void player.loadLiked().catch(() => undefined)
  })

  return stopAll
}
