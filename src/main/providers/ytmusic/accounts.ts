/**
 * The YouTube accounts (channels) behind one Google login: a primary account plus any brand
 * accounts. YouTube's channel switcher (`accounts_list`) returns one item per identity.
 */

export interface RawAccount {
  /** The brand account's page id, or 'primary' for the Google account's own channel. */
  id: string
  /** Page id to act on behalf of (brand accounts only). */
  pageId?: string
  /** YouTube's own redirect that makes this identity the active one in a browser session. */
  signinUrl?: string
  name: string
  handle?: string
  email?: string
  photoUrl?: string
  selected: boolean
}

interface TextLike {
  toString(): string
}

/** The bits of youtubei.js' AccountItem used here. */
export interface AccountItemLike {
  account_name?: TextLike
  account_byline?: TextLike
  channel_handle?: TextLike
  account_photo?: { url?: string }[]
  is_selected?: boolean
  endpoint?: { payload?: { supportedTokens?: Record<string, unknown>[] } }
}

const token = (item: AccountItemLike, key: string): unknown =>
  item.endpoint?.payload?.supportedTokens?.find((t) => key in t)?.[key]

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/

export function parseAccounts(items: AccountItemLike[]): RawAccount[] {
  return items.map((item, index) => {
    // "<pageId>||<userId>" for brand accounts, "<userId>||" for the primary one.
    const datasync = (token(item, 'datasyncIdToken') as { datasyncIdToken?: string } | undefined)?.datasyncIdToken ?? ''
    const [first = '', second = ''] = datasync.split('||')
    const pageId = second ? first : undefined
    const signinUrl = (token(item, 'accountSigninToken') as { signinUrl?: string } | undefined)?.signinUrl
    const byline = item.account_byline?.toString() ?? ''
    const handle = item.channel_handle?.toString() || undefined
    return {
      id: pageId ?? (index === 0 ? 'primary' : `primary-${index}`),
      pageId,
      signinUrl: signinUrl?.startsWith('/signin') ? signinUrl : undefined,
      name: item.account_name?.toString() || 'Cuenta de YouTube',
      handle,
      email: byline.match(EMAIL)?.[0],
      photoUrl: item.account_photo?.[0]?.url,
      selected: Boolean(item.is_selected)
    }
  })
}
