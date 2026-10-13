// Skins from the Winamp Skin Museum (skins.webamp.org), by md5.

export const SKIN_SCHEME = 'skin'

export interface MuseumSkin {
  id: string
  name: string
  screenshotUrl: string
  /** `skin://` url the app serves from its cache (downloaded on first use). */
  url: string
}

export const museumSkin = (md5: string, name: string): MuseumSkin => ({
  id: md5,
  name,
  screenshotUrl: `https://r2.webampskins.org/screenshots/${md5}.png`,
  url: `${SKIN_SCHEME}://${md5}/skin.wsz`
})

/** Shown first in the skin browser. Their authors are credited in the Skin Museum. */
export const FEATURED_SKINS: MuseumSkin[] = [
  museumSkin('138a1e1a2ca1cdae30cd83259ab307c9', 'Pioneer DEH-P80'),
  museumSkin('0a425db4cb3c5a00536b2aacba3a4f40', 'Pioneer ST3'),
  museumSkin('f849e4cb7a5f7aa31e9cc6076c716fd3', 'Pioneer Premier Pro 2'),
  museumSkin('ecd30bbe0ddc5d88e46a717a2cd03ada', 'PioneerAmp'),
  museumSkin('1e76e3e3a465baeec638b2f16b9ee821', 'Pioneer Arawn'),
  museumSkin('76ceedcc88d04aae0c229af333ff2a34', 'Pioneer HiFi'),
  museumSkin('994a36c513da75ed4df0c39201c4f051', 'Pioneer (verde)'),
  museumSkin('528c3cbe3bf13a30da1e38a232ff8814', 'Pioneer MPEG Layer 3'),
  museumSkin('15b335a910a90d7707f542ac17856b44', 'Pioneer (clásico)'),
  museumSkin('5bb9899f341fdba0ea63481387203f89', 'Pioneer Wood'),
  museumSkin('8767f1e887d4a05609201b6065f1b685', 'Green Dimension V2'),
  museumSkin('58c11dcf63d39cefb97f4318501cbe4e', 'XMMS Green'),
  museumSkin('9c2acf819a762ee574e24f30bb7fb8bd', 'Mean Green Machine'),
  museumSkin('01f813e84418267956a8e3ec7c3701c9', 'HulkAMP')
]
