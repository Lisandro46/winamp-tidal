import { existsSync, mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, net, protocol } from 'electron'
import { museumSkin, SKIN_SCHEME, type MuseumSkin } from '@shared/skins'

/**
 * Skins from the Winamp Skin Museum (skins.webamp.org), served to Webamp as
 * `skin://<md5>/skin.wsz`. Each one is downloaded once and kept in the user
 * data folder, so a chosen skin keeps working offline.
 */

const MUSEUM_API = 'https://api.webamp.org/graphql'
const MUSEUM_FILES = 'https://r2.webampskins.org'
const MD5 = /^[0-9a-f]{32}$/

/** Must run before the app is ready. */
export function registerSkinScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SKIN_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
  ])
}

const cacheDir = (): string => {
  const dir = join(app.getPath('userData'), 'skins')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Serves `skin://<md5>/…` from the cache, downloading it from the museum the first time. */
export function handleSkinScheme(): void {
  protocol.handle(SKIN_SCHEME, async (request) => {
    const md5 = new URL(request.url).hostname
    if (!MD5.test(md5)) return new Response('bad skin id', { status: 400 })
    const file = join(cacheDir(), `${md5}.wsz`)
    if (!existsSync(file)) {
      try {
        const response = await net.fetch(`${MUSEUM_FILES}/skins/${md5}.wsz`)
        if (!response.ok) return new Response('skin not found', { status: 404 })
        await writeFile(file, Buffer.from(await response.arrayBuffer()))
      } catch {
        return new Response('offline', { status: 503 })
      }
    }
    return new Response(await readFile(file), {
      headers: { 'content-type': 'application/zip', 'access-control-allow-origin': '*' }
    })
  })
}

interface MuseumResult {
  md5: string
  filename: string
  screenshot_url: string | null
  nsfw: boolean | null
}

/** Classic (.wsz) skins matching `query`, safe for work and with a screenshot. */
export async function searchSkins(query: string): Promise<MuseumSkin[]> {
  const response = await net.fetch(MUSEUM_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: 'query ($q: String!) { search_skins(query: $q, first: 60) { md5 filename screenshot_url nsfw } }',
      variables: { q: query }
    })
  })
  if (!response.ok) throw new Error(`No se pudo buscar en el Skin Museum (${response.status})`)
  const { data } = (await response.json()) as { data?: { search_skins: MuseumResult[] } }
  return (data?.search_skins ?? [])
    .filter((skin) => !skin.nsfw && skin.screenshot_url && !/\.wal$/i.test(skin.filename))
    .map((skin) => museumSkin(skin.md5, skin.filename.replace(/\.(wsz|zip)$/i, '').replace(/_/g, ' ')))
}
