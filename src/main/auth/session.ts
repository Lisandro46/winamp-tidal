import { login, refresh, type OAuthConfig, type TokenSet } from './oauthPkce'
import { tokenStore } from './store'

export class ApiError extends Error {}

/**
 * Authorized JSON request: retries once with a fresh token on 401 and once after
 * a 429 back-off. Returns parsed JSON, or undefined for empty (204) responses.
 */
async function authorizedRequest<T>(
  url: string,
  init: RequestInit,
  accessToken: () => Promise<string>,
  invalidate: () => void
): Promise<T | undefined> {
  const send = async (): Promise<Response> =>
    fetch(url, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/vnd.api+json' } : {}),
        ...init.headers,
        Authorization: `Bearer ${await accessToken()}`
      }
    })

  let response = await send()
  if (response.status === 401) {
    // Token was revoked or expired early: get a new one and try once more.
    invalidate()
    response = await send()
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After') ?? 1)
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 10) * 1000))
    response = await send()
  }
  if (!response.ok) {
    const text = await response.text()
    throw new ApiError(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`)
  }
  const text = await response.text()
  return text ? (JSON.parse(text) as T) : undefined
}

/** Holds a user's tokens and performs authorized JSON requests, refreshing as needed. */
export class OAuthSession {
  private tokens: TokenSet | undefined
  private refreshing: Promise<TokenSet> | undefined

  constructor(
    private readonly key: string,
    private readonly config: () => OAuthConfig
  ) {
    this.tokens = tokenStore.get(key)
  }

  isLoggedIn(): boolean {
    return this.tokens != null
  }

  async login(): Promise<void> {
    this.save(await login(this.config()))
  }

  logout(): void {
    this.save(undefined)
  }

  private save(tokens: TokenSet | undefined): void {
    this.tokens = tokens
    tokenStore.set(this.key, tokens)
  }

  private async accessToken(): Promise<string> {
    if (!this.tokens) throw new ApiError('Not logged in')
    if (Date.now() < this.tokens.expiresAt) return this.tokens.accessToken
    this.refreshing ??= refresh(this.config(), this.tokens).finally(() => {
      this.refreshing = undefined
    })
    try {
      this.save(await this.refreshing)
    } catch (error) {
      this.save(undefined)
      throw new ApiError(`Session expired, please reconnect (${(error as Error).message})`)
    }
    return this.tokens!.accessToken
  }

  request<T>(url: string, init: RequestInit = {}): Promise<T | undefined> {
    return authorizedRequest<T>(
      url,
      init,
      () => this.accessToken(),
      () => {
        if (this.tokens) this.tokens = { ...this.tokens, expiresAt: 0 }
      }
    )
  }
}

/**
 * App-level token (OAuth client credentials): no user involved, so it only
 * reaches public resources such as the catalog and search.
 */
export class ClientCredentialsSession {
  private token: { value: string; expiresAt: number } | undefined
  private fetching: Promise<string> | undefined

  constructor(
    private readonly tokenUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string
  ) {}

  get configured(): boolean {
    return this.clientId !== '' && this.clientSecret !== ''
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')
    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials' })
    })
    if (!response.ok) {
      throw new ApiError(`Client credentials rejected (${response.status}): ${(await response.text()).slice(0, 200)}`)
    }
    const json = (await response.json()) as { access_token: string; expires_in: number }
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 }
    return json.access_token
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value
    this.fetching ??= this.fetchToken().finally(() => {
      this.fetching = undefined
    })
    return this.fetching
  }

  request<T>(url: string, init: RequestInit = {}): Promise<T | undefined> {
    return authorizedRequest<T>(
      url,
      init,
      () => this.accessToken(),
      () => {
        this.token = undefined
      }
    )
  }
}
