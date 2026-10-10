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
const DEFAULT_CONFIG_DIR = 'C:\\Program Files\\EqualizerAPO\\config'

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

  async apply(state: EqState): Promise<EqStatus> {
    const status = await this.status()
    if (!status.configDir) return status
    try {
      await writeFile(join(status.configDir, OUR_FILE), renderConfig(state), 'utf8')
      await this.ensureIncluded(status.configDir)
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
    if (current.split(/\r?\n/).some((line) => line.trim() === INCLUDE_LINE)) return
    const separator = current && !current.endsWith('\n') ? '\r\n' : ''
    await writeFile(configFile, `${current}${separator}${INCLUDE_LINE}\r\n`, 'utf8')
  }
}
