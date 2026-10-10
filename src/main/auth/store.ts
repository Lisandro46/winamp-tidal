import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { AppSettings, TidalCredentials } from '@shared/types'
import type { TokenSet } from './oauthPkce'

const dir = (): string => {
  const path = app.getPath('userData')
  mkdirSync(path, { recursive: true })
  return path
}

function readJson<T>(file: string, fallback: T): T {
  const path = join(dir(), file)
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Secrets are encrypted with the OS keychain (DPAPI on Windows) via safeStorage. */
function readEncrypted<T>(file: string): T | undefined {
  const path = join(dir(), file)
  if (!existsSync(path) || !safeStorage.isEncryptionAvailable()) return undefined
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(path))) as T
  } catch {
    return undefined
  }
}

function writeEncrypted(file: string, value: unknown): void {
  const path = join(dir(), file)
  if (value === undefined) {
    writeFileSync(path, '')
    return
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows no permite cifrar datos en esta cuenta')
  writeFileSync(path, safeStorage.encryptString(JSON.stringify(value)))
}

export const tokenStore = {
  get: (provider: string): TokenSet | undefined => readEncrypted<TokenSet>(`tokens-${provider}.bin`),
  set(provider: string, tokens: TokenSet | undefined): void {
    try {
      writeEncrypted(`tokens-${provider}.bin`, tokens)
    } catch {
      // without encryption the session just isn't remembered
    }
  }
}

/** The user's own TIDAL app, entered in the setup dialog. */
export const credentialStore = {
  get: (): TidalCredentials | undefined => readEncrypted<TidalCredentials>('tidal-app.bin'),
  set: (credentials: TidalCredentials | undefined): void => writeEncrypted('tidal-app.bin', credentials)
}

const DEFAULT_SETTINGS: AppSettings = {}

export const settingsStore = {
  get(): AppSettings {
    return { ...DEFAULT_SETTINGS, ...readJson<Partial<AppSettings>>('settings.json', {}) }
  },
  update(patch: Partial<AppSettings>): AppSettings {
    const next = { ...settingsStore.get(), ...patch }
    writeFileSync(join(dir(), 'settings.json'), JSON.stringify(next, null, 2))
    return next
  }
}
