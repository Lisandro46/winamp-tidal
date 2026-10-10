import { login, refresh, type OAuthConfig, type TokenSet } from './oauthPkce'
import { tokenStore } from './store'

export class ApiError extends Error {}

/** Holds a provider's tokens and performs authorized JSON requests, refreshing as needed. */
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

  /** Authorized fetch; returns parsed JSON, or undefined for empty (204) responses. */
  async request<T>(url: string, init: RequestInit = {}): Promise<T | undefined> {
    const send = async (): Promise<Response> =>
      fetch(url, {
        ...init,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/vnd.api+json' } : {}),
          ...init.headers,
          Authorization: `Bearer ${await this.accessToken()}`
        }
      })

    let response = await send()
    if (response.status === 401 && this.tokens) {
      // Token was revoked or expired early: force a refresh once.
      this.tokens = { ...this.tokens, expiresAt: 0 }
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
}
