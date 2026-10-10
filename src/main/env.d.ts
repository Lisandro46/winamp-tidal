/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  readonly MAIN_VITE_SPOTIFY_CLIENT_ID?: string
  readonly MAIN_VITE_TIDAL_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
