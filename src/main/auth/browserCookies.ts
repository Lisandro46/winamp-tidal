/**
 * macOS: signs in to YouTube Music with the session of the user's own browser.
 * Reads the youtube.com cookies of the default browser (Chrome, Brave, Edge, Arc, Chromium,
 * Vivaldi, Firefox or Safari). Cookie values are never logged and temp copies are deleted.
 */
import { execFile } from 'node:child_process'
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { constants as fsc } from 'node:fs'
import { copyFile, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { shell } from 'electron'

const run = promisify(execFile)

export interface RawCookie {
  host: string
  name: string
  value: string
}

type Kind = 'chromium' | 'firefox' | 'safari'

interface Browser {
  name: string
  kind: Kind
  /** Lower-case bundle ids (LaunchServices stores them lower-cased). */
  bundleIds: string[]
  /** Under ~/Library/Application Support (chromium and firefox). */
  dataDir?: string
  /** Keychain service of the cookie key (chromium). */
  keychain?: string
}

const BROWSERS: Browser[] = [
  { name: 'Chrome', kind: 'chromium', bundleIds: ['com.google.chrome'], dataDir: 'Google/Chrome', keychain: 'Chrome Safe Storage' },
  { name: 'Brave', kind: 'chromium', bundleIds: ['com.brave.browser'], dataDir: 'BraveSoftware/Brave-Browser', keychain: 'Brave Safe Storage' },
  { name: 'Edge', kind: 'chromium', bundleIds: ['com.microsoft.edgemac'], dataDir: 'Microsoft Edge', keychain: 'Microsoft Edge Safe Storage' },
  { name: 'Arc', kind: 'chromium', bundleIds: ['company.thebrowser.browser'], dataDir: 'Arc/User Data', keychain: 'Arc Safe Storage' },
  { name: 'Chromium', kind: 'chromium', bundleIds: ['org.chromium.chromium'], dataDir: 'Chromium', keychain: 'Chromium Safe Storage' },
  { name: 'Vivaldi', kind: 'chromium', bundleIds: ['com.vivaldi.vivaldi'], dataDir: 'Vivaldi', keychain: 'Vivaldi Safe Storage' },
  { name: 'Firefox', kind: 'firefox', bundleIds: ['org.mozilla.firefox'], dataDir: 'Firefox/Profiles' },
  { name: 'Safari', kind: 'safari', bundleIds: ['com.apple.safari'] }
]

/** Thrown with a message that is already fit to show the user. */
export class BrowserLoginError extends Error {}

const SUPPORT = join(homedir(), 'Library', 'Application Support')
const isSession = (name: string): boolean => /^(__Secure-3PAPISID|SAPISID)$/.test(name)

// ---- Pure helpers (also used by the self-check) ----------------------------------

/** Key for Chromium's "v10" cookie encryption on macOS, from the Keychain password. */
export function chromiumKey(password: string): Buffer {
  return pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')
}

/** Decrypts a Chromium "v10"/"v11" cookie value; newer databases prefix SHA-256(host) to the plaintext. */
export function decryptChromium(encrypted: Buffer, key: Buffer, host: string): string {
  const tag = encrypted.subarray(0, 3).toString('latin1')
  if (tag !== 'v10' && tag !== 'v11') return encrypted.toString('utf8')
  const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  let plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()])
  if (plain.length >= 32 && plain.subarray(0, 32).equals(createHash('sha256').update(host).digest())) {
    plain = plain.subarray(32)
  }
  return plain.toString('utf8')
}

/** Parses Safari's Cookies.binarycookies. */
export function parseBinaryCookies(data: Buffer): RawCookie[] {
  const cookies: RawCookie[] = []
  if (data.length < 8 || data.toString('latin1', 0, 4) !== 'cook') return cookies
  const pages = data.readUInt32BE(4)
  const sizes: number[] = []
  for (let i = 0; i < pages; i++) sizes.push(data.readUInt32BE(8 + i * 4))
  let pageStart = 8 + pages * 4
  const text = (buf: Buffer, from: number): string => {
    let end = from
    while (end < buf.length && buf[end] !== 0) end++
    return buf.toString('utf8', from, end)
  }
  for (const size of sizes) {
    const page = data.subarray(pageStart, pageStart + size)
    pageStart += size
    if (page.length < 8) continue
    const count = page.readUInt32LE(4)
    for (let i = 0; i < count; i++) {
      const at = page.readUInt32LE(8 + i * 4)
      if (at + 48 > page.length) continue
      const record = page.subarray(at)
      cookies.push({
        host: text(record, record.readUInt32LE(16)),
        name: text(record, record.readUInt32LE(20)),
        value: text(record, record.readUInt32LE(28))
      })
    }
  }
  return cookies
}

/** "name=value; …" for the youtube.com cookies, one per name (the `.youtube.com` one wins). */
export function toCookieHeader(cookies: RawCookie[]): string {
  const byName = new Map<string, RawCookie>()
  for (const cookie of cookies) {
    if (!/(^|\.)youtube\.com$/.test(cookie.host) || !cookie.value || !/^[\w.-]+$/.test(cookie.name)) continue
    const previous = byName.get(cookie.name)
    if (!previous || (cookie.host.startsWith('.') && !previous.host.startsWith('.'))) byName.set(cookie.name, cookie)
  }
  return [...byName.values()].map((c) => `${c.name}=${c.value}`).join('; ')
}

export const hasSession = (cookies: RawCookie[]): boolean =>
  cookies.some((c) => isSession(c.name) && /(^|\.)youtube\.com$/.test(c.host) && c.value)

// ---- Reading each browser --------------------------------------------------------

/** Lists a browser's data folder; a macOS privacy block is reported instead of looking like "no cookies". */
async function listDir(path: string, browser: Browser): Promise<string[]> {
  try {
    return await readdir(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES') {
      throw new BrowserLoginError(
        `macOS no deja a Winamp Remote leer los datos de ${browser.name}. Abrí Ajustes del Sistema → Privacidad y seguridad → Acceso total al disco, activá "Winamp Remote" y reabrí la app.`
      )
    }
    return []
  }
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false
  )

/** Copies the database (and its WAL) away so a running browser's lock doesn't matter. */
async function sqliteRows<T>(db: string, sql: string): Promise<T[]> {
  const dir = await mkdtemp(join(tmpdir(), 'wr-cookies-'))
  try {
    const copy = join(dir, 'db.sqlite')
    await copyFile(db, copy, fsc.COPYFILE_FICLONE)
    for (const ext of ['-wal', '-shm']) await copyFile(db + ext, copy + ext).catch(() => undefined)
    const { stdout } = await run('/usr/bin/sqlite3', ['-json', copy, sql], { maxBuffer: 32 * 1024 * 1024 })
    return stdout.trim() ? (JSON.parse(stdout) as T[]) : []
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const keys = new Map<string, Buffer>()

async function keychainKey(browser: Browser): Promise<Buffer> {
  const cached = keys.get(browser.name)
  if (cached) return cached
  try {
    const { stdout } = await run('/usr/bin/security', ['find-generic-password', '-w', '-s', browser.keychain!])
    const key = chromiumKey(stdout.replace(/\r?\n$/, ''))
    keys.set(browser.name, key)
    return key
  } catch {
    throw new BrowserLoginError(
      `No pude leer la clave de ${browser.name} en el Llavero. Aceptá el aviso de macOS ("Permitir") cuando aparezca y volvé a intentar.`
    )
  }
}

async function chromiumCookies(browser: Browser): Promise<RawCookie[]> {
  const root = join(SUPPORT, browser.dataDir!)
  const profiles = (await listDir(root, browser)).filter((d) => d === 'Default' || /^Profile \d+$/.test(d))
  const out: RawCookie[] = []
  for (const profile of profiles) {
    let db = join(root, profile, 'Network', 'Cookies')
    if (!(await exists(db))) db = join(root, profile, 'Cookies')
    if (!(await exists(db))) continue
    const rows = await sqliteRows<{ host_key: string; name: string; value: string; ev: string }>(
      db,
      "SELECT host_key, name, value, hex(encrypted_value) AS ev FROM cookies WHERE host_key LIKE '%youtube.com'"
    )
    let key: Buffer | undefined
    for (const row of rows) {
      let value = row.value
      if (!value && row.ev) {
        key ??= await keychainKey(browser)
        try {
          value = decryptChromium(Buffer.from(row.ev, 'hex'), key, row.host_key)
        } catch {
          continue
        }
      }
      out.push({ host: row.host_key, name: row.name, value })
    }
  }
  return out
}

async function firefoxCookies(browser: Browser): Promise<RawCookie[]> {
  const root = join(SUPPORT, browser.dataDir!)
  const out: RawCookie[] = []
  for (const profile of await listDir(root, browser)) {
    const db = join(root, profile, 'cookies.sqlite')
    if (!(await exists(db))) continue
    const rows = await sqliteRows<{ host: string; name: string; value: string }>(
      db,
      "SELECT host, name, value FROM moz_cookies WHERE host LIKE '%youtube.com'"
    )
    out.push(...rows)
  }
  return out
}

async function safariCookies(): Promise<RawCookie[]> {
  const paths = [
    join(homedir(), 'Library', 'Containers', 'com.apple.Safari', 'Data', 'Library', 'Cookies', 'Cookies.binarycookies'),
    join(homedir(), 'Library', 'Cookies', 'Cookies.binarycookies')
  ]
  let denied = false
  const out: RawCookie[] = []
  for (const path of paths) {
    try {
      out.push(...parseBinaryCookies(await readFile(path)))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES') denied = true
    }
  }
  if (!out.length && denied) {
    throw new BrowserLoginError(
      'Safari no deja leer sus cookies sin permiso. Abrí Ajustes del Sistema → Privacidad y seguridad → Acceso total al disco, activá "Winamp Remote" y reabrí la app. O usá Chrome, Brave, Edge, Arc o Firefox.'
    )
  }
  return out
}

async function readBrowser(browser: Browser): Promise<RawCookie[]> {
  if (browser.kind === 'chromium') return chromiumCookies(browser)
  if (browser.kind === 'firefox') return firefoxCookies(browser)
  return safariCookies()
}

async function installed(browser: Browser): Promise<boolean> {
  if (browser.kind === 'safari') return true
  return exists(join(SUPPORT, browser.dataDir!))
}

/** The browser that opens https links, or undefined when it is one we can't read. */
async function defaultBrowser(): Promise<{ browser?: Browser; known: boolean }> {
  try {
    const plist = join(homedir(), 'Library', 'Preferences', 'com.apple.LaunchServices', 'com.apple.launchservices.secure.plist')
    const { stdout } = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist])
    const handlers = (JSON.parse(stdout) as { LSHandlers?: Record<string, string>[] }).LSHandlers ?? []
    const handler = handlers.find((h) => h.LSHandlerURLScheme === 'https')?.LSHandlerRoleAll?.toLowerCase()
    if (handler) return { browser: BROWSERS.find((b) => b.bundleIds.includes(handler)), known: true }
  } catch {
    // no LaunchServices preferences: macOS then defaults to Safari
  }
  return { browser: BROWSERS.find((b) => b.kind === 'safari'), known: false }
}

// ---- Sign-in flow ----------------------------------------------------------------

const POLL_MS = 2000
const TIMEOUT_MS = 3 * 60 * 1000
const LOGIN_URL = 'https://music.youtube.com'

let current: AbortController | undefined
const listeners = new Set<(text: string) => void>()

/** Progress messages for the library's status bar. */
export function onLoginProgress(listener: (text: string) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const progress = (text: string): void => listeners.forEach((l) => l(text))

export function cancelBrowserLogin(): void {
  current?.abort()
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true })
  })

/** YouTube cookies ("name=value; …") if the browser has a signed-in YouTube session, else undefined. */
async function sessionOf(browser: Browser): Promise<string | undefined> {
  const cookies = await readBrowser(browser)
  return hasSession(cookies) ? toCookieHeader(cookies) : undefined
}

/**
 * Signs in with the default browser's session. If it has none yet, opens YouTube Music
 * there and waits (up to 3 minutes) until the cookies appear. Resolves to a cookie header.
 */
export async function signInWithBrowser(): Promise<string> {
  current?.abort()
  const abort = new AbortController()
  current = abort
  const { signal } = abort
  keys.clear()
  try {
    const { browser, known } = await defaultBrowser()
    let candidates: Browser[]
    if (browser && (await installed(browser))) candidates = [browser]
    else {
      // Default browser we can't read (Opera, Orion…): try the ones we can, without bothering the user's default.
      const all = await Promise.all(BROWSERS.map(async (b) => ((await installed(b)) && b.kind !== 'safari' ? b : undefined)))
      candidates = all.filter((b): b is Browser => !!b)
      if (!candidates.length) {
        throw new BrowserLoginError(
          `Tu navegador${known ? ' por defecto' : ''} no es compatible. Usá Chrome, Brave, Edge, Arc, Firefox o Safari.`
        )
      }
    }
    const label = candidates.length === 1 ? candidates[0].name : 'tu navegador'

    const find = async (): Promise<string | undefined> => {
      let firstError: unknown
      for (const candidate of candidates) {
        try {
          const found = await sessionOf(candidate)
          if (found) return found
        } catch (error) {
          firstError ??= error
        }
      }
      // Only report a failure when nothing could be read at all.
      if (firstError) throw firstError
      return undefined
    }

    progress(`Buscando tu sesión de YouTube Music en ${label}…`)
    const existing = await find()
    if (existing) return existing

    progress(`Abrí YouTube Music en ${label} e iniciá sesión…`)
    await shell.openExternal(LOGIN_URL)
    const deadline = Date.now() + TIMEOUT_MS
    while (!signal.aborted && Date.now() < deadline) {
      await sleep(POLL_MS, signal)
      if (signal.aborted) break
      progress(`Esperando que inicies sesión en ${label}…`)
      const found = await find()
      if (found) return found
    }
    if (signal.aborted) throw new BrowserLoginError('Inicio de sesión cancelado')
    throw new BrowserLoginError(
      `No encontré tu sesión en ${label}. Iniciá sesión en music.youtube.com y probá de nuevo (el navegador puede tardar unos segundos en guardarla).`
    )
  } finally {
    if (current === abort) current = undefined
    keys.clear()
  }
}
