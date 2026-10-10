import type { RemoteApi } from '../shared/types'

declare global {
  interface Window {
    remote: RemoteApi
  }
}

export {}
