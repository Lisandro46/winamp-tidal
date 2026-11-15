/**
 * Which Winamp windows are open and how they look (Milkdrop starts off; the user's choices persist).
 * Positions are not saved: the windows start stacked, as Webamp lays them out by default.
 */

import type { ViewLayout } from '@shared/types'

const MAIN_WIDTH = 275
const STACK_HEIGHT = 464

export const DEFAULT_VIEW: ViewLayout = {
  equalizer: true,
  playlist: true,
  milkdrop: false,
  shade: {},
  library: true
}

interface WebampWindow {
  open: boolean
  shade?: boolean
  size: [number, number]
}

interface WebampStore {
  getState(): { windows: { genWindows: Record<string, WebampWindow> } }
  subscribe(listener: () => void): () => void
}

/** Webamp's `windowLayout` option for the saved view; `origin` is where the stack's top-left goes. */
export function windowLayoutFor(view: ViewLayout | undefined, origin: { left: number; top: number }) {
  const v = { ...DEFAULT_VIEW, ...view, shade: { ...view?.shade } }
  const at = (dx: number, dy: number) => ({ left: origin.left + dx, top: origin.top + dy })
  const size = (s?: [number, number]) => (s ? { extraWidth: s[0], extraHeight: s[1] } : undefined)
  return {
    main: { position: at(0, 0), shadeMode: !!v.shade.main },
    equalizer: { position: at(0, 116), closed: !v.equalizer, shadeMode: !!v.shade.equalizer },
    playlist: {
      position: at(0, 232),
      closed: !v.playlist,
      shadeMode: !!v.shade.playlist,
      size: size(v.playlistSize)
    },
    milkdrop: { position: at(MAIN_WIDTH, 0), closed: !v.milkdrop, size: size(v.milkdropSize) }
  }
}

/** Where to put the stack so it is centered on a `width`×`height` area (Windows' full-screen stage). */
export const centeredOrigin = (width: number, height: number): { left: number; top: number } => ({
  left: Math.max(0, Math.round((width - MAIN_WIDTH) / 2)),
  top: Math.max(0, Math.round((height - STACK_HEIGHT) / 2))
})

const sizeOf = (w: WebampWindow | undefined): [number, number] | undefined =>
  w && (w.size[0] || w.size[1]) ? [w.size[0], w.size[1]] : undefined

/** Saves the view whenever a window opens/closes/shades/resizes or the library is shown/hidden. */
export function persistView(store: WebampStore, library: HTMLElement): void {
  let last = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  const snapshot = (): ViewLayout => {
    const w = store.getState().windows.genWindows
    return {
      equalizer: !!w.equalizer?.open,
      playlist: !!w.playlist?.open,
      milkdrop: !!w.milkdrop?.open,
      shade: { main: !!w.main?.shade, equalizer: !!w.equalizer?.shade, playlist: !!w.playlist?.shade },
      playlistSize: sizeOf(w.playlist),
      milkdropSize: sizeOf(w.milkdrop),
      library: !library.classList.contains('hidden')
    }
  }
  const check = (): void => {
    const view = snapshot()
    const key = JSON.stringify(view)
    if (key === last) return
    last = key
    clearTimeout(timer)
    timer = setTimeout(() => void window.remote.setView(view), 400)
  }
  last = JSON.stringify(snapshot())
  store.subscribe(check)
  new MutationObserver(check).observe(library, { attributes: true, attributeFilter: ['class'] })
}
