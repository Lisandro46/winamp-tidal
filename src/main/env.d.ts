/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  readonly MAIN_VITE_TIDAL_CLIENT_ID?: string
  readonly MAIN_VITE_TIDAL_CLIENT_SECRET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
