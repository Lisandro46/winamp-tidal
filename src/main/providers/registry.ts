import type { PlaybackState, ProviderId, ProviderInfo } from '@shared/types'
import { settingsStore } from '../auth/store'
import type { MusicProvider } from './provider'
import { SpotifyProvider } from './spotify'
import { SystemProvider } from './system'
import { TidalProvider } from './tidal'

type Listener = (state: PlaybackState | null) => void

/** Owns the provider instances and which one is active; forwards its state. */
export class ProviderRegistry {
  private providers = new Map<ProviderId, MusicProvider>(
    [new SpotifyProvider(), new TidalProvider(), new SystemProvider()].map((p) => [p.id, p])
  )
  private activeId: ProviderId
  private stopWatching: (() => void) | undefined

  constructor(private readonly onState: Listener) {
    const saved = settingsStore.get().provider
    this.activeId = this.providers.has(saved) ? saved : 'system'
  }

  get active(): MusicProvider {
    return this.providers.get(this.activeId)!
  }

  get(id: ProviderId): MusicProvider {
    const provider = this.providers.get(id)
    if (!provider) throw new Error(`Unknown provider ${id}`)
    return provider
  }

  info(id: ProviderId): ProviderInfo {
    const provider = this.get(id)
    return {
      id,
      name: provider.name,
      connected: provider.isConnected(),
      capabilities: provider.capabilities,
      setupHint: provider.setupHint()
    }
  }

  list(): ProviderInfo[] {
    return [...this.providers.keys()].map((id) => this.info(id))
  }

  /** (Re)starts state updates from the active provider, if it can be used. */
  restartWatch(): void {
    this.stopWatching?.()
    this.stopWatching = undefined
    this.onState(null)
    if (this.active.isConnected()) this.stopWatching = this.active.watch(this.onState)
  }

  select(id: ProviderId): ProviderInfo {
    this.get(id)
    this.activeId = id
    settingsStore.update({ provider: id })
    this.restartWatch()
    return this.info(id)
  }

  dispose(): void {
    this.stopWatching?.()
  }
}
