import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { AppSettings } from '@shared/types'
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

/** Tokens are encrypted with the OS keychain (DPAPI on Windows) via safeStorage. */
export const tokenStore = {
  get(provider: string): TokenSet | undefined {
    const path = join(dir(), `tokens-${provider}.bin`)
    if (!existsSync(path) || !safeStorage.isEncryptionAvailable()) return undefined
    try {
      return JSON.parse(safeStorage.decryptString(readFileSync(path))) as TokenSet
    } catch {
      return undefined
    }
  },
  set(provider: string, tokens: TokenSet | undefined): void {
    const path = join(dir(), `tokens-${provider}.bin`)
    if (!tokens) {
      writeFileSync(path, '')
      return
    }
    if (!safeStorage.isEncryptionAvailable()) return
    writeFileSync(path, safeStorage.encryptString(JSON.stringify(tokens)))
  }
}

const DEFAULT_SETTINGS: AppSettings = { provider: 'system' }

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
