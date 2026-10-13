/**
 * Helpers for living on a transparent, full-desktop window: clicks on empty
 * space pass through to the apps behind, panels can be dragged around.
 */

import type { DesktopLayout, Rect } from '@shared/types'

/** UI that should receive the mouse; everything else is click-through. */
const INTERACTIVE = '#webamp, #library:not(.hidden), #tidal-search:not(.hidden), #tidal-setup:not(.hidden), #skins:not(.hidden), [id^="webamp-"]'

export function trackPointer(): void {
  let interactive: boolean | undefined
  let pressed = false

  const update = (x: number, y: number): void => {
    // Keep the mouse while a button is held so drags never "fall through".
    const next = pressed || (document.elementFromPoint(x, y)?.closest(INTERACTIVE) ?? null) !== null
    if (next === interactive) return
    interactive = next
    window.remote.setInteractive(next)
  }

  window.addEventListener('mousemove', (event) => update(event.clientX, event.clientY))
  window.addEventListener('mousedown', () => {
    pressed = true
  })
  window.addEventListener('mouseup', (event) => {
    pressed = false
    update(event.clientX, event.clientY)
  })
  // Leaving the window (e.g. moving onto the taskbar) must release the mouse.
  document.addEventListener('mouseleave', () => {
    pressed = false
    interactive = false
    window.remote.setInteractive(false)
  })
}

// v2: stored relative to the primary monitor, so it survives monitor layout changes.
export const LIBRARY_POSITION_KEY = 'library-position-v2'

let displays: Rect[] = []
let primary: Rect = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }

/**
 * Webamp centers itself over #stage, so the stage is sized to the primary monitor.
 * The library defaults to that monitor's right side until the user moves it.
 */
export function placeOnPrimary(stage: HTMLElement, library: HTMLElement, layout: DesktopLayout): void {
  displays = layout.displays
  primary = layout.primary
  const { x, y, width, height } = primary
  Object.assign(stage.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` })
  library.style.left = `${x + width - 600}px`
  library.style.top = `${y + 60}px`
}

interface Position {
  left: number
  top: number
  width?: number
  height?: number
}

const TITLE_GRIP = 60

const contains = (d: Rect, x: number, y: number): boolean =>
  x >= d.x && x < d.x + d.width && y >= d.y && y < d.y + d.height

/**
 * The window also covers gaps between monitors that aren't visible on any screen.
 * Keep the panel's title bar on a real monitor so it can always be grabbed.
 */
export function keepOnScreen(panel: HTMLElement): void {
  const rect = panel.getBoundingClientRect()
  // Hidden panels have no box yet; they are checked again when shown.
  if (!rect.width) return
  const gripX = rect.left + Math.min(rect.width / 2, TITLE_GRIP)
  const gripY = rect.top + 8
  const target =
    displays.find((d) => contains(d, gripX, gripY)) ??
    displays.find((d) => contains(d, rect.left + rect.width / 2, rect.top + rect.height / 2)) ??
    primary
  const left = Math.min(Math.max(rect.left, target.x), target.x + Math.max(0, target.width - rect.width))
  const top = Math.min(Math.max(rect.top, target.y), target.y + target.height - TITLE_GRIP)
  panel.style.left = `${left}px`
  panel.style.top = `${top}px`
}

/** Centers `panel` on the primary monitor (for panels that have never been moved). */
export function centerOnPrimary(panel: HTMLElement): void {
  const rect = panel.getBoundingClientRect()
  panel.style.left = `${primary.x + (primary.width - rect.width) / 2}px`
  panel.style.top = `${primary.y + (primary.height - rect.height) / 3}px`
}

/**
 * Makes `panel` draggable by `handle`; position and size survive restarts.
 * Returns whether a saved position was restored.
 */
export function makeFloating(panel: HTMLElement, handle: HTMLElement, storageKey: string): boolean {
  let restored = false
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Position | null
    if (saved) {
      restored = true
      panel.style.left = `${primary.x + saved.left}px`
      panel.style.top = `${primary.y + saved.top}px`
      if (saved.width) panel.style.width = `${saved.width}px`
      if (saved.height) panel.style.height = `${saved.height}px`
    }
  } catch {
    // storage unavailable: keep the default position
  }
  keepOnScreen(panel)

  const save = (): void => {
    const rect = panel.getBoundingClientRect()
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ left: rect.left - primary.x, top: rect.top - primary.y, width: rect.width, height: rect.height })
      )
    } catch {
      // ignore
    }
  }

  handle.addEventListener('pointerdown', (event) => {
    if ((event.target as HTMLElement).closest('button')) return
    const rect = panel.getBoundingClientRect()
    const offsetX = event.clientX - rect.left
    const offsetY = event.clientY - rect.top
    handle.setPointerCapture(event.pointerId)
    const move = (e: PointerEvent): void => {
      panel.style.left = `${e.clientX - offsetX}px`
      panel.style.top = `${e.clientY - offsetY}px`
    }
    const up = (): void => {
      handle.removeEventListener('pointermove', move)
      keepOnScreen(panel)
      save()
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up, { once: true })
  })

  // CSS `resize` changes the size; remember it too (ignoring hide/show).
  new ResizeObserver(() => {
    if (panel.getBoundingClientRect().width) save()
  }).observe(panel)
  return restored
}

/** Minimal slice of Webamp's store we need to reposition its windows. */
interface WebampWindows {
  store: {
    getState(): { windows: { genWindows: Record<string, { position: { x: number; y: number } }> } }
    dispatch(action: unknown): void
  }
}

/**
 * Same as keepOnScreen, for the Winamp windows: after a drag ends, any window
 * whose title bar landed outside every monitor is pulled back onto the nearest one.
 */
export function keepWebampOnScreen(webamp: WebampWindows): () => void {
  const check = (): void => {
    const windows = webamp.store.getState().windows.genWindows
    const positions: Record<string, { x: number; y: number }> = {}
    for (const [id, { position }] of Object.entries(windows)) {
      const element = document.getElementById(`${id}-window`)
      if (!element) continue
      const rect = element.getBoundingClientRect()
      const gripX = rect.left + Math.min(rect.width / 2, TITLE_GRIP)
      const gripY = rect.top + 6
      if (displays.some((d) => contains(d, gripX, gripY))) continue
      const target =
        displays.find((d) => contains(d, rect.left + rect.width / 2, rect.top + rect.height / 2)) ?? primary
      const left = Math.min(Math.max(rect.left, target.x), target.x + target.width - rect.width)
      const top = Math.min(Math.max(rect.top, target.y), target.y + target.height - rect.height)
      positions[id] = { x: position.x + (left - rect.left), y: position.y + (top - rect.top) }
    }
    if (Object.keys(positions).length) webamp.store.dispatch({ type: 'UPDATE_WINDOW_POSITIONS', positions })
  }
  // Let Webamp finish its own drag handling first.
  window.addEventListener('mouseup', () => setTimeout(check, 0))
  return check
}

/** Monitors were added, removed or rearranged while running. */
export function updateLayout(stage: HTMLElement, library: HTMLElement, layout: DesktopLayout): void {
  displays = layout.displays
  primary = layout.primary
  const { x, y, width, height } = primary
  Object.assign(stage.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` })
  keepOnScreen(library)
}
