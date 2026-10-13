import type { ProviderId } from '@shared/types'
import { TidalProvider } from './tidal'
import type { MusicProvider } from './types'
import { YtMusicProvider } from './ytmusic'

export function createProvider(id: ProviderId, onLikedChange: (ids: string[]) => void): MusicProvider {
  return id === 'ytmusic' ? new YtMusicProvider(onLikedChange) : new TidalProvider(onLikedChange)
}
