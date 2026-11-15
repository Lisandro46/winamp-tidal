/**
 * Recolors the Media Library and its dialogs with the skin Webamp is showing.
 *
 * Webamp keeps the active skin in its redux store: `skinPlaylistStyle` (pledit.txt: list text,
 * current-track text, list background, selection) and `skinImages` (the sprites). We derive a few
 * base colors from those, expand them into a full set of CSS custom properties on `:root`
 * (see the `--skin-*` and derived variables in app.css) and refresh whenever the skin changes.
 */

type Rgb = [number, number, number]

interface PlaylistStyle {
  normal: string
  current: string
  normalbg: string
  selectedbg: string
}
interface GenExColors {
  windowBackground: string
  itemBackground: string
  itemForeground: string
  playlistSelection: string
}
interface DisplayState {
  skinPlaylistStyle: PlaylistStyle | null
  skinGenExColors: GenExColors | null
  skinImages: Record<string, string>
}
interface ThemedWebamp {
  store: {
    getState(): { display: DisplayState }
    subscribe(listener: () => void): () => void
  }
}

// Classic Winamp defaults, used until a skin says otherwise (and when one fails to load).
const DEFAULTS = {
  panel: [56, 55, 87] as Rgb,
  itemBg: [0, 0, 0] as Rgb,
  itemFg: [0, 255, 0] as Rgb,
  current: [255, 255, 255] as Rgb,
  selected: [0, 0, 198] as Rgb
}

function parse(color: string | undefined): Rgb | undefined {
  if (!color) return undefined
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color.trim())
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!hex) return undefined
  const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

const mix = (a: Rgb, b: Rgb, amountOfB: number): Rgb =>
  [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * amountOfB)) as Rgb
const css = ([r, g, b]: Rgb): string => `rgb(${r}, ${g}, ${b})`
const luminance = ([r, g, b]: Rgb): number => (0.299 * r + 0.587 * g + 0.114 * b) / 255
/** Readable text color on `bg`. */
const onColor = (bg: Rgb): Rgb => (luminance(bg) > 0.55 ? [16, 16, 24] : [245, 245, 250])
/** `fg`, nudged away from `bg` until it is legible. */
function legible(fg: Rgb, bg: Rgb): Rgb {
  let out = fg
  for (let i = 0; i < 6 && Math.abs(luminance(out) - luminance(bg)) < 0.35; i++) {
    out = mix(out, luminance(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255], 0.3)
  }
  return out
}

/** Average opaque color of a sprite (data URL), or undefined if it can't be decoded. */
function averageColor(src: string | undefined): Promise<Rgb | undefined> {
  if (!src) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 8
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return resolve(undefined)
        ctx.drawImage(image, 0, 0, 8, 8)
        const data = ctx.getImageData(0, 0, 8, 8).data
        let r = 0
        let g = 0
        let b = 0
        let n = 0
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 200) continue
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          n++
        }
        resolve(n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : undefined)
      } catch {
        resolve(undefined)
      }
    }
    image.onerror = () => resolve(undefined)
    image.src = src
  })
}

function apply(panel: Rgb, itemBg: Rgb, itemFg: Rgb, current: Rgb, selected: Rgb): void {
  const onPanel = onColor(panel)
  const button = mix(panel, [255, 255, 255], luminance(panel) > 0.7 ? 0.35 : 0.14)
  const vars: Record<string, Rgb> = {
    '--skin-panel': panel,
    '--skin-panel-dark': itemBg,
    '--skin-text': legible(itemFg, itemBg),
    '--skin-accent': legible(current, itemBg),
    '--skin-selected': selected,
    '--skin-on-selected': onColor(selected),
    '--skin-on-panel': onPanel,
    '--skin-button': button,
    '--skin-on-button': onColor(button),
    '--skin-bevel-light': mix(panel, [255, 255, 255], 0.45),
    '--skin-bevel-dark': mix(panel, [0, 0, 0], 0.55),
    '--skin-titlebar-top': mix(panel, [255, 255, 255], 0.3),
    '--skin-titlebar-bottom': mix(panel, [0, 0, 0], 0.25)
  }
  const style = document.documentElement.style
  for (const [name, value] of Object.entries(vars)) style.setProperty(name, css(value))
}

/** Applies the current skin's colors now and on every skin change. */
export function applySkinTheme(webamp: ThemedWebamp): void {
  let token = 0
  let last: unknown[] = []

  const refresh = async (): Promise<void> => {
    const display = webamp.store.getState().display
    const key = [display.skinPlaylistStyle, display.skinGenExColors, display.skinImages]
    if (key.every((value, i) => value === last[i])) return
    last = key
    const mine = ++token
    const list = display.skinPlaylistStyle
    const gen = display.skinGenExColors
    const sprite = await averageColor(display.skinImages.PLAYLIST_LEFT_TILE ?? display.skinImages.PLAYLIST_TOP_TILE)
    if (mine !== token) return
    const itemBg = parse(list?.normalbg) ?? parse(gen?.itemBackground) ?? DEFAULTS.itemBg
    apply(
      sprite ?? parse(gen?.windowBackground) ?? DEFAULTS.panel,
      itemBg,
      parse(list?.normal) ?? parse(gen?.itemForeground) ?? DEFAULTS.itemFg,
      parse(list?.current) ?? DEFAULTS.current,
      parse(list?.selectedbg) ?? parse(gen?.playlistSelection) ?? DEFAULTS.selected
    )
  }
  webamp.store.subscribe(() => void refresh())
  void refresh()
}
