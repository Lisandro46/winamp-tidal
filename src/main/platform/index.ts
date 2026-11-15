import type { PlatformBackend } from './types'
import { createWindowsBackend } from './windows'

export type { AudioBackend, EqBackend, PlatformBackend } from './types'

/** Picks the backend for the current OS. Non-Windows platforms use the Windows one until a native backend exists. */
function createBackend(): PlatformBackend {
  switch (process.platform) {
    case 'win32':
    default:
      return createWindowsBackend()
  }
}

const backend = createBackend()

export const audio = backend.audio
export const eq = backend.eq
