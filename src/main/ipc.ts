import { ipcMain, type BrowserWindow } from 'electron'
import type { AuthInfo, Collection, EqState, PlayContext, PlayMode, ProviderId, TidalCredentials, Track, YtAccounts } from '@shared/types'
import { cancelBrowserLogin, onLoginProgress } from './auth/browserCookies'
import { settingsStore } from './auth/store'
import { setAccountLabel } from './menu'
import { audio, eq } from './platform'
import { createProvider } from './providers'
import { TidalProvider } from './providers/tidal'
import type { MusicProvider } from './providers/types'
import { YtMusicProvider } from './providers/ytmusic'
import { searchSkins } from './skins'
import { openVisualizer, visualizerWindow } from './visualizerWindow'

/** Wires the renderer's `window.remote` API to the music service, the audio backend and the equalizer. */
export function registerIpc(window: BrowserWindow): () => void {
  const send = (channel: string, payload: unknown): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
  // The full-screen Milkdrop also follows the audio and the current track.
  const broadcast = (channel: string, payload: unknown): void => {
    send(channel, payload)
    visualizerWindow()?.webContents.send(channel, payload)
  }
  const onLiked = (ids: string[]): void => send('remote:liked', ids)
  // TIDAL is driven through the Windows-only SMTC helper; elsewhere only YouTube Music is offered.
  const tidalSupported = process.platform === 'win32'
  const initialProvider: ProviderId = tidalSupported ? (settingsStore.get().provider ?? 'tidal') : 'ytmusic'
  const adopt = (created: MusicProvider): MusicProvider => {
    created.queueAdded = (added) => send('remote:queueAdd', added)
    return created
  }
  let provider: MusicProvider = adopt(createProvider(initialProvider, onLiked))

  const auth = (): AuthInfo => ({
    provider: provider.id,
    capabilities: provider.capabilities,
    configured: provider.configured,
    connected: provider.connected,
    catalog: provider.catalogAvailable,
    hint: provider.capabilities.credentials && !provider.configured ? 'Solo control remoto' : undefined
  })
  // Credentials only exist for TIDAL's catalog mode.
  const tidal = (): TidalProvider => {
    if (!(provider instanceof TidalProvider)) throw new Error('Esto solo aplica a TIDAL')
    return provider
  }

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
  // User library calls need a login; catalog calls may work without one.
  const library =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      await provider.ensureUser()
      return fn(...args)
    }
  const catalog =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      await provider.ensureCatalog()
      return fn(...args)
    }

  handle('getAuth', auth)
  // The connected account is mirrored in the native Cuenta menu.
  const showAccount = (info: YtAccounts): YtAccounts => {
    setAccountLabel(info.current ? info.current.handle ?? info.current.name : undefined)
    return info
  }
  handle('getAccounts', async () => {
    if (!provider.accountsInfo || !provider.connected) return showAccount({ accounts: [] })
    return showAccount(await provider.accountsInfo())
  })
  handle('selectAccount', async (id: string) => {
    if (!provider.selectAccount) throw new Error('Este servicio no tiene varias cuentas')
    return showAccount(await provider.selectAccount(id))
  })
  handle('connect', async () => {
    await provider.login()
    await provider.loadLiked()
    return auth()
  })
  handle('cancelLogin', () => cancelBrowserLogin())
  const offLoginProgress = onLoginProgress((text) => send('remote:loginStatus', text))
  handle('disconnect', async () => {
    await provider.logout()
    await provider.loadLiked()
    return auth()
  })
  handle('getCredentials', () => tidal().credentialsInfo())
  handle('setCredentials', async (credentials: TidalCredentials | null) => {
    await tidal().setCredentials(credentials)
    settingsStore.update({ setupDone: true })
    await provider.loadLiked().catch(() => undefined)
    return auth()
  })
  handle('importYouTubeSession', async (text: string) => {
    if (!(provider instanceof YtMusicProvider)) throw new Error('Esto solo aplica a YouTube Music')
    await provider.importSession(text)
    await provider.loadLiked().catch(() => undefined)
    return auth()
  })
  handle('setProvider', async (id: ProviderId) => {
    if (id === 'tidal' && !tidalSupported) throw new Error('TIDAL solo está disponible en Windows')
    // YouTube Music needs nothing else; TIDAL's setup continues with its catalog choice.
    settingsStore.update({ provider: id, ...(id === 'ytmusic' ? { setupDone: true } : {}) })
    if (id !== provider.id) {
      const previous = provider
      stopWatching()
      provider = adopt(createProvider(id, onLiked))
      await previous.dispose().catch(() => undefined)
      watchState()
      void provider.loadLiked().catch(() => undefined)
    }
    send('remote:provider', auth())
    return auth()
  })
  handle('getSettings', () => settingsStore.get())
  handle('setSkin', (url: string | undefined) => {
    settingsStore.update({ skinUrl: url })
  })

  handle('searchSkins', (query: string) => searchSkins(query))

  handle('getLikedTracks', library(() => provider.likedTracks()))
  handle('getPlaylists', library(() => provider.userPlaylists()))
  handle('getMixes', library(() => provider.mixes()))
  handle('getAlbums', library(() => provider.userAlbums()))
  handle('getArtists', library(() => provider.userArtists()))
  handle('getTracks', catalog((collection: Collection) => provider.collectionTracks(collection)))
  handle('search', catalog((query: string) => provider.search(query)))
  handle('setLiked', library((id: string, liked: boolean) => provider.setLiked(id, liked)))
  handle('getLikedIds', () => provider.likedIds())
  // Library edits: saving albums/playlists/artists and adding tracks to the user's playlists.
  const unsupported = (): never => {
    throw new Error('Este servicio no permite esto')
  }
  handle('getSaved', library(() => (provider.savedKeys ? provider.savedKeys() : Promise.resolve([]))))
  handle('getFollowing', library((ids: string[]) => (provider.followingArtists ? provider.followingArtists(ids) : Promise.resolve([]))))
  handle('setSaved', library((collection: Collection, saved: boolean) => provider.setSaved ? provider.setSaved(collection, saved) : unsupported()))
  handle('getEditablePlaylists', library((ids: string[]) => provider.editablePlaylists ? provider.editablePlaylists(ids) : unsupported()))
  handle('addToPlaylist', library((id: string, ids: string[]) => provider.addToPlaylist ? provider.addToPlaylist(id, ids) : unsupported()))
  handle('createPlaylist', library((name: string, ids: string[]) => provider.createPlaylist ? provider.createPlaylist(name, ids) : unsupported()))

  handle('playTrack', (context: PlayContext) => provider.playTrack(context))
  handle('setQueue', (tracks: Track[]) => provider.setQueue(tracks))
  handle('setPlayMode', (mode: PlayMode) => provider.setPlayMode?.(mode))
  handle('startRadio', async (trackId?: string) => {
    if (!provider.startRadio) throw new Error('Este servicio no tiene radio')
    return provider.startRadio(trackId)
  })
  handle('resume', () => provider.resume())
  handle('pause', () => provider.pause())
  handle('next', () => provider.next())
  handle('previous', () => provider.previous())
  handle('seek', (ms: number) => provider.seek(ms))

  handle('setVolume', (volume: number) => audio.setVolume(volume))
  handle('getEq', () => eq.status())
  handle('setEq', async (state: EqState) => {
    settingsStore.update({ eq: state })
    return eq.apply(state)
  })

  // `point` is in the main window's CSS pixels (the page is zoomed by the UI scale).
  handle('openVisualizer', (point: { x: number; y: number }, preset?: string) => {
    const bounds = window.getBounds()
    const zoom = window.webContents.getZoomFactor()
    openVisualizer({ x: Math.round(bounds.x + point.x * zoom), y: Math.round(bounds.y + point.y * zoom) }, preset)
    visualizer(true)
  })

  ipcMain.on('window:control', (_event, action: 'minimize' | 'close') => {
    if (action === 'minimize') window.minimize()
    else window.close()
  })

  // The visualizer only needs audio while the window can be seen.
  const visualizer = (on: boolean): void => void audio.setVisualizer(on).catch(() => undefined)
  window.on('minimize', () => visualizer(visualizerWindow() != null))
  window.on('restore', () => visualizer(true))

  // The renderer calls `ready` once its listeners exist (also after a reload),
  // so the first state/volume messages are never lost.
  let stops: (() => void)[] = []
  let unwatch = (): void => undefined
  const stopWatching = (): void => {
    unwatch()
    unwatch = () => undefined
  }
  const watchState = (): void => {
    stopWatching()
    unwatch = provider.watch((state) => broadcast('remote:state', state))
  }
  const stopAll = (): void => {
    stopWatching()
    stops.forEach((stop) => stop())
    stops = []
  }
  handle('ready', () => {
    stopAll()
    watchState()
    stops.push(
      audio.onVolume((volume) => send('remote:volume', volume)),
      audio.onPcm((chunk) => broadcast('remote:pcm', chunk))
    )
    visualizer(true)
    void provider.loadLiked().catch(() => undefined)
  })

  return () => {
    offLoginProgress()
    cancelBrowserLogin()
    stopAll()
    void provider.dispose()
  }
}
