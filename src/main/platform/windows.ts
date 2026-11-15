import { Equalizer } from '../audio/equalizer'
import { smtc } from '../smtc/helperClient'
import type { PlatformBackend } from './types'

export function createWindowsBackend(): PlatformBackend {
  return { audio: smtc, eq: new Equalizer() }
}
