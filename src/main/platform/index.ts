import { createMacBackend } from './mac'
import type { PlatformBackend } from './types'
import { createWindowsBackend } from './windows'

export type { AudioBackend, EqBackend, PlatformBackend } from './types'

/** Picks the backend for the current OS. Other platforms use the Windows one until a native backend exists. */
function createBackend(): PlatformBackend {
  switch (process.platform) {
    case 'darwin':
      return createMacBackend()
    case 'win32':
    default:
      return createWindowsBackend()
  }
}

const backend = createBackend()

export const audio = backend.audio
export const eq = backend.eq
