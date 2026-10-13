import { BrowserWindow, session as sessions, type Session } from 'electron'

/**
 * music.youtube.com in a hidden window: it does the actual playback (with the
 * user's account when logged in) and is driven through its HTML5 player
 * (`#movie_player`) from the main process.
 */

const HOME = 'https://music.youtube.com/'
const LOGIN = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=' + encodeURIComponent(HOME)
const PARTITION = 'persist:ytmusic'
const READY_TIMEOUT_MS = 20_000

/** YouTube player states. */
export const enum YtState {
  Unstarted = -1,
  Ended = 0,
  Playing = 1,
  Paused = 2,
  Buffering = 3,
  Cued = 5
}

export interface YtStatus {
  videoId: string
  title: string
  author: string
  state: YtState
  positionMs: number
  durationMs: number
  /** An ad is playing instead of the track. */
  ad: boolean
}

/** Runs inside the page (main world), where the player's methods live. */
const STATUS_SCRIPT = `(() => {
  const p = document.querySelector('#movie_player')
  if (!p || typeof p.getPlayerState !== 'function') return null
  const d = p.getVideoData ? p.getVideoData() : {}
  return {
    videoId: d.video_id || '',
    title: d.title || '',
    author: d.author || '',
    state: p.getPlayerState(),
    positionMs: Math.round((p.getCurrentTime() || 0) * 1000),
    durationMs: Math.round((p.getDuration() || 0) * 1000),
    ad: p.classList.contains('ad-showing')
  }
})()`

/** A regular Chrome user agent, without the "Electron/…" token. */
const chromeUserAgent = (): string =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`

/**
 * Google refuses to sign in embedded Chromium ("This browser or app may not be
 * secure"), even with a plain Chrome user agent, but accepts Firefox. During the
 * sign-in the window presents itself as Firefox and drops Chromium's client hints.
 */
const FIREFOX_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0'
const GOOGLE_URLS = ['https://accounts.google.com/*', 'https://*.google.com/*', 'https://accounts.youtube.com/*']

/** youtube.com cookies from a "cookie:" header, a Netscape cookies.txt or a JSON array export. */
export function parseCookies(text: string): { name: string; value: string }[] {
  const input = text.trim()
  if (input.startsWith('[')) {
    try {
      const list = JSON.parse(input) as { name?: string; value?: string; domain?: string }[]
      return list
        .filter((c) => c.name && c.value != null && (!c.domain || c.domain.includes('youtube.com')))
        .map((c) => ({ name: c.name!, value: c.value! }))
    } catch {
      return []
    }
  }
  if (/\t/.test(input)) {
    return input
      .split(/\r?\n/)
      .map((line) => line.replace(/^#HttpOnly_/, '').split('\t'))
      .filter((f) => f.length >= 7 && f[0].includes('youtube.com'))
      .map((f) => ({ name: f[5], value: f[6].trim() }))
  }
  return input
    .replace(/^cookie:\s*/i, '')
    .split(/;\s*/)
    .map((pair) => {
      const at = pair.indexOf('=')
      return at > 0 ? { name: pair.slice(0, at).trim(), value: pair.slice(at + 1).trim() } : undefined
    })
    .filter((c): c is { name: string; value: string } => c != null && /^[\w.-]+$/.test(c.name))
}

export class YtPlayerWindow {
  readonly session: Session = sessions.fromPartition(PARTITION)
  private window: BrowserWindow | undefined
  private ready: Promise<void> | undefined

  /** True while the sign-in window is open. */
  private signingIn = false

  constructor() {
    this.session.setUserAgent(chromeUserAgent())
    this.session.webRequest.onBeforeSendHeaders({ urls: GOOGLE_URLS }, (details, callback) => {
      if (!this.signingIn) return callback({ requestHeaders: details.requestHeaders })
      const headers = Object.fromEntries(
        Object.entries(details.requestHeaders).filter(([name]) => !/^sec-ch-ua/i.test(name))
      )
      headers['User-Agent'] = FIREFOX_USER_AGENT
      callback({ requestHeaders: headers })
    })
  }

  private create(): BrowserWindow {
    const window = new BrowserWindow({
      show: false,
      width: 520,
      height: 720,
      title: 'YouTube Music',
      autoHideMenuBar: true,
      webPreferences: {
        session: this.session,
        // Keeps playing and reporting time while hidden.
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
        contextIsolation: true,
        sandbox: true
      }
    })
    // Closing the login window only hides it; the player must keep living.
    window.on('close', (event) => {
      if (this.window === window) {
        event.preventDefault()
        window.hide()
      }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    return window
  }

  /** Loads music.youtube.com (once) and waits for its player. */
  ensure(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) {
      this.window = this.create()
      this.ready = undefined
    }
    if (!this.ready) {
      const window = this.window
      this.ready = (async () => {
        await window.loadURL(HOME)
        const until = Date.now() + READY_TIMEOUT_MS
        while (Date.now() < until) {
          if (await this.run<boolean>(`!!document.querySelector('#movie_player')`).catch(() => false)) return
          await new Promise((r) => setTimeout(r, 300))
        }
        throw new Error('YouTube Music no cargó. Revisá la conexión a internet.')
      })()
      this.ready.catch(() => (this.ready = undefined))
    }
    return this.ready
  }

  private run<T>(script: string): Promise<T> {
    const window = this.window
    if (!window || window.isDestroyed()) return Promise.reject(new Error('YouTube Music no está abierto'))
    return window.webContents.executeJavaScript(script, true) as Promise<T>
  }

  /** Calls a method of the page's player, after it has loaded. */
  private async player(call: string): Promise<void> {
    await this.ensure()
    await this.run(`document.querySelector('#movie_player').${call}`)
  }

  load = (videoId: string): Promise<void> => this.player(`loadVideoById(${JSON.stringify(videoId)})`)
  play = (): Promise<void> => this.player('playVideo()')
  pause = (): Promise<void> => this.player('pauseVideo()')
  seek = (positionMs: number): Promise<void> => this.player(`seekTo(${positionMs / 1000}, true)`)

  status(): Promise<YtStatus | null> {
    if (!this.ready) return Promise.resolve(null)
    return this.run<YtStatus | null>(STATUS_SCRIPT).catch(() => null)
  }

  /** "name=value; …" for every youtube.com cookie, to authenticate the catalog. */
  async cookie(): Promise<string> {
    const cookies = await this.session.cookies.get({ domain: 'youtube.com' })
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  }

  /** Shows Google's sign-in; resolves once YouTube Music has the login cookies. */
  async login(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) this.window = this.create()
    const window = this.window
    this.ready = undefined
    const done = new Promise<void>((resolve, reject) => {
      const check = async (): Promise<void> => {
        if (/(^|; )(__Secure-3PAPISID|SAPISID)=/.test(await this.cookie())) {
          cleanup()
          resolve()
        }
      }
      const onCookie = (): void => void check()
      const onHide = (): void => {
        cleanup()
        reject(new Error('Inicio de sesión cancelado'))
      }
      const cleanup = (): void => {
        this.session.cookies.off('changed', onCookie)
        window.off('hide', onHide)
      }
      this.session.cookies.on('changed', onCookie)
      window.once('hide', onHide)
      void check()
    })
    this.signingIn = true
    window.webContents.setUserAgent(FIREFOX_USER_AGENT)
    window.center()
    window.show()
    await window.loadURL(LOGIN)
    try {
      await done
    } finally {
      this.signingIn = false
      window.webContents.setUserAgent(chromeUserAgent())
      if (window.isVisible()) window.hide()
    }
    await this.session.cookies.flushStore()
    await this.ensure()
  }

  /**
   * Signs in with the session of the user's own browser, for accounts Google
   * won't sign in here (passkey-only). `text` is the music.youtube.com cookies
   * as a "cookie:" request header, a cookies.txt export or a JSON export.
   */
  async importCookies(text: string): Promise<void> {
    const cookies = parseCookies(text)
    if (!cookies.some((c) => /^(__Secure-3PAPISID|SAPISID)$/.test(c.name))) {
      throw new Error('Eso no tiene la sesión de YouTube (falta la cookie SAPISID). Revisá que estés logueado y copiá todo.')
    }
    const expirationDate = Date.now() / 1000 + 365 * 24 * 3600
    for (const { name, value } of cookies) {
      await this.session.cookies.set({
        url: HOME,
        domain: '.youtube.com',
        path: '/',
        name,
        value,
        secure: true,
        httpOnly: !/PAPISID$|^SAPISID$/.test(name),
        sameSite: 'no_restriction',
        expirationDate
      })
    }
    // Chromium writes cookies to disk lazily; don't lose the session if the app is killed.
    await this.session.cookies.flushStore()
    // Reload music.youtube.com with the new session (also closes a pending sign-in window).
    this.window?.hide()
    this.ready = undefined
    await this.ensure()
  }

  async logout(): Promise<void> {
    await this.session.clearStorageData()
    this.ready = undefined
    if (this.window && !this.window.isDestroyed()) await this.ensure()
  }

  dispose(): void {
    void this.session.cookies.flushStore()
    const window = this.window
    this.window = undefined
    this.ready = undefined
    if (window && !window.isDestroyed()) window.destroy()
  }
}
