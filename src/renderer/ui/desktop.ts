/**
 * Helpers for living on a transparent, full-desktop window: clicks on empty
 * space pass through to the apps behind, panels can be dragged around.
 */

/** UI that should receive the mouse; everything else is click-through. */
const INTERACTIVE = '#webamp, #library:not(.hidden), [id^="webamp-"]'

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

interface Position {
  left: number
  top: number
  width?: number
  height?: number
}

const clampToViewport = (panel: HTMLElement): void => {
  const rect = panel.getBoundingClientRect()
  const left = Math.min(Math.max(0, rect.left), window.innerWidth - 80)
  const top = Math.min(Math.max(0, rect.top), window.innerHeight - 30)
  panel.style.left = `${left}px`
  panel.style.top = `${top}px`
}

/** Makes `panel` draggable by `handle`; position and size survive restarts. */
export function makeFloating(panel: HTMLElement, handle: HTMLElement, storageKey: string): void {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Position | null
    if (saved) {
      panel.style.left = `${saved.left}px`
      panel.style.top = `${saved.top}px`
      if (saved.width) panel.style.width = `${saved.width}px`
      if (saved.height) panel.style.height = `${saved.height}px`
    }
  } catch {
    // storage unavailable: keep the CSS default position
  }
  clampToViewport(panel)

  const save = (): void => {
    const rect = panel.getBoundingClientRect()
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
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
      clampToViewport(panel)
      save()
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up, { once: true })
  })

  // CSS `resize` changes the size; remember it too.
  new ResizeObserver(() => save()).observe(panel)
}
