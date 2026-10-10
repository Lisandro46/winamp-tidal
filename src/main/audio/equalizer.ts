import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { EqState, EqStatus } from '@shared/types'

/** Winamp's 10 bands, in Hz (same order as Webamp's sliders). */
export const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000]
const RANGE_DB = 12
const OUR_FILE = 'winamp-remote.txt'
const INCLUDE_LINE = `Include: ${OUR_FILE}`
const STOCK_DEMO_LINE = 'Include: example.txt'
const BACKUP_FILE = 'config.before-winamp-remote.txt'
const DEFAULT_CONFIG_DIR = 'C:\\Program Files\\EqualizerAPO\\config'

/**
 * Equalizer APO briefly locks config files while reloading them, which makes
 * writes fail with EPERM/EBUSY even though Users have write access. Retry a few times.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const transient = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
      if (!transient || attempt >= attempts) throw error
      await new Promise((r) => setTimeout(r, 100 * attempt))
    }
  }
}

/** Slider value 0-100 (50 = flat) → dB. */
const toDb = (value: number): number => ((value - 50) / 50) * RANGE_DB
const fmt = (db: number): string => db.toFixed(1)

async function findConfigDir(): Promise<string | undefined> {
  try {
    const { stdout } = await promisify(execFile)('reg', [
      'query',
      'HKLM\\SOFTWARE\\EqualizerAPO',
      '/v',
      'ConfigPath'
    ])
    const match = /ConfigPath\s+REG_\w+\s+(.+)/.exec(stdout)
    if (match && existsSync(match[1].trim())) return match[1].trim()
  } catch {
    // not installed, or registry not readable
  }
  return existsSync(DEFAULT_CONFIG_DIR) ? DEFAULT_CONFIG_DIR : undefined
}

/** Equalizer APO config for the Winamp sliders, with automatic headroom to avoid clipping. */
export function renderConfig(state: EqState): string {
  const header = '# Managed by Winamp Remote — changes here are overwritten.\n'
  if (!state.on) return `${header}# Equalizer off\n`
  const gains = state.bands.map(toDb)
  const headroom = Math.max(0, ...gains)
  const preamp = toDb(state.preamp) - headroom
  const graphic = EQ_BANDS.map((hz, i) => `${hz} ${fmt(gains[i] ?? 0)}`).join('; ')
  return `${header}Preamp: ${fmt(preamp)} dB\nGraphicEQ: ${graphic}\n`
}

/**
 * Drives Equalizer APO (https://sourceforge.net/projects/equalizerapo/): the app
 * writes its own config file and includes it once from config.txt. APO reloads
 * config files on change, so slider moves are heard immediately.
 */
export class Equalizer {
  private configDir: string | undefined
  private detected = false

  async status(): Promise<EqStatus> {
    if (!this.detected) {
      this.configDir = await findConfigDir()
      this.detected = true
    }
    return { installed: this.configDir != null, configDir: this.configDir }
  }

  /** Applies are serialized: concurrent writes to the same file fail on Windows. */
  apply(state: EqState): Promise<EqStatus> {
    const run = this.queue.then(() => this.write(state))
    this.queue = run.catch(() => undefined)
    return run
  }

  private queue: Promise<unknown> = Promise.resolve()

  private async write(state: EqState): Promise<EqStatus> {
    const status = await this.status()
    if (!status.configDir) return status
    const configDir = status.configDir
    try {
      await withRetry(() => writeFile(join(configDir, OUR_FILE), renderConfig(state), 'utf8'))
      await withRetry(() => this.ensureIncluded(configDir))
      return status
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const message =
        code === 'EPERM' || code === 'EACCES'
          ? `Sin permiso para escribir en ${status.configDir}`
          : (error as Error).message
      return { ...status, error: message }
    }
  }

  private async ensureIncluded(configDir: string): Promise<void> {
    const configFile = join(configDir, 'config.txt')
    const current = existsSync(configFile) ? await readFile(configFile, 'utf8') : ''
    const lines = current.split(/\r?\n/).map((line) => line.trim())

    // APO ships a demo config (-6 dB preamp + bass boost from example.txt) that would
    // stack with the Winamp EQ. Replace it, keeping a backup; custom configs are left alone.
    if (lines.includes(STOCK_DEMO_LINE)) {
      const backup = join(configDir, BACKUP_FILE)
      if (!existsSync(backup)) await writeFile(backup, current, 'utf8')
      await writeFile(configFile, `# Ecualizador controlado por Winamp Remote (original en ${BACKUP_FILE})\r\n${INCLUDE_LINE}\r\n`, 'utf8')
      return
    }
    if (lines.includes(INCLUDE_LINE)) return
    const separator = current && !current.endsWith('\n') ? '\r\n' : ''
    await writeFile(configFile, `${current}${separator}${INCLUDE_LINE}\r\n`, 'utf8')
  }
}
