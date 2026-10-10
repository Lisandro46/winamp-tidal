import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { shell } from 'electron'

export interface OAuthConfig {
  authorizeUrl: string
  tokenUrl: string
  clientId: string
  scopes: string[]
  /** Loopback port; the redirect URI is http://127.0.0.1:<port>/callback. */
  port: number
}

export interface TokenSet {
  accessToken: string
  refreshToken?: string
  /** Epoch milliseconds. */
  expiresAt: number
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

const base64Url = (buffer: Buffer): string =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const redirectUri = (port: number): string => `http://127.0.0.1:${port}/callback`

const RESULT_PAGE = (message: string): string => `<!doctype html><meta charset="utf-8">
<title>Winamp Remote</title>
<body style="background:#000;color:#0f0;font:14px monospace;padding:40px">
<p>${message}</p><p>Ya podés cerrar esta pestaña.</p></body>`

/** Opens the system browser on the provider's login page and waits for the loopback redirect. */
async function waitForAuthorizationCode(config: OAuthConfig, url: URL, state: string): Promise<string> {
  let server: Server | undefined
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Login timed out')), LOGIN_TIMEOUT_MS)
      server = createServer((req, res) => {
        const params = new URL(req.url ?? '/', redirectUri(config.port)).searchParams
        if (!req.url?.startsWith('/callback')) {
          res.writeHead(404).end()
          return
        }
        const error = params.get('error')
        const code = params.get('code')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        if (error || !code || params.get('state') !== state) {
          res.end(RESULT_PAGE(`Error de login: ${error ?? 'respuesta inválida'}`))
          clearTimeout(timer)
          reject(new Error(`Login failed: ${error ?? 'invalid response'}`))
          return
        }
        res.end(RESULT_PAGE('Login correcto ✔'))
        clearTimeout(timer)
        resolve(code)
      })
      server.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      server.listen(config.port, '127.0.0.1', () => {
        void shell.openExternal(url.toString())
      })
    })
  } finally {
    server?.close()
  }
}

async function requestToken(tokenUrl: string, body: Record<string, string>): Promise<TokenSet> {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body)
  })
  if (!response.ok) {
    throw new Error(`Token request failed (${response.status}): ${await response.text()}`)
  }
  const json = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    // Refresh a minute early so requests never race the expiry.
    expiresAt: Date.now() + (json.expires_in - 60) * 1000
  }
}

/** Full Authorization Code + PKCE flow through the system browser. */
export async function login(config: OAuthConfig): Promise<TokenSet> {
  const verifier = base64Url(randomBytes(48))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  const state = base64Url(randomBytes(16))

  const url = new URL(config.authorizeUrl)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri(config.port),
    scope: config.scopes.join(' '),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state
  }).toString()

  const code = await waitForAuthorizationCode(config, url, state)
  return requestToken(config.tokenUrl, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(config.port),
    client_id: config.clientId,
    code_verifier: verifier
  })
}

export async function refresh(config: OAuthConfig, tokens: TokenSet): Promise<TokenSet> {
  if (!tokens.refreshToken) throw new Error('No refresh token; please log in again')
  const next = await requestToken(config.tokenUrl, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: config.clientId
  })
  // Some providers only rotate the refresh token occasionally.
  return { ...next, refreshToken: next.refreshToken ?? tokens.refreshToken }
}
