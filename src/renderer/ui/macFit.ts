/**
 * macOS layout: instead of a transparent full-screen overlay, the app window is exactly as
 * big as what is visible (the Winamp windows, plus the Media Library / dialogs docked to their
 * right). It is a normal movable window, so focus, Mission Control and dragging to another
 * display all behave natively.
 */

const GAP = 8
const PANELS = '#library:not(.hidden), #tidal-search:not(.hidden), #tidal-setup:not(.hidden), #skins:not(.hidden)'

/** True when the macOS window-fitting layout is active. */
export const isFit = (): boolean => document.body.classList.contains('mac-fit')

/** Starts keeping the native window sized to the visible content. */
export function startFit(): () => void {
  let tx = 0
  let ty = 0
  let last = ''
  let queued = false

  const fit = (): void => {
    queued = false
    const webamp = document.getElementById('webamp')
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const el of document.querySelectorAll<HTMLElement>('#webamp .window')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      left = Math.min(left, r.left)
      top = Math.min(top, r.top)
      right = Math.max(right, r.right)
      bottom = Math.max(bottom, r.bottom)
    }
    if (webamp && Number.isFinite(left)) {
      // Slide the Winamp windows so their top-left corner is the window's origin.
      if (Math.abs(left) > 0.5 || Math.abs(top) > 0.5) {
        tx -= left
        ty -= top
        webamp.style.transform = `translate(${tx}px, ${ty}px)`
        right -= left
        bottom -= top
      }
    } else {
      right = 0
      bottom = 0
    }
    const slot = `${Math.ceil(right) + (right > 0 ? GAP : 0)}px`
    if (document.documentElement.style.getPropertyValue('--slot-left') !== slot) {
      document.documentElement.style.setProperty('--slot-left', slot)
    }
    let width = right
    let height = bottom
    for (const panel of document.querySelectorAll<HTMLElement>(PANELS)) {
      const r = panel.getBoundingClientRect()
      width = Math.max(width, r.right)
      height = Math.max(height, r.bottom)
    }
    width = Math.ceil(width)
    height = Math.ceil(height)
    if (width < 1 || height < 1) return
    const key = `${width}x${height}`
    if (key === last) return
    last = key
    window.remote.fitWindow(width, height)
  }

  const schedule = (): void => {
    if (queued) return
    queued = true
    // Not rAF: it is paused while the window is covered by other apps.
    setTimeout(fit, 16)
  }

  new MutationObserver(schedule).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style']
  })
  const resizes = new ResizeObserver(schedule)
  for (const id of ['library', 'tidal-search', 'tidal-setup', 'skins']) {
    const el = document.getElementById(id)
    if (el) resizes.observe(el)
  }
  window.addEventListener('resize', schedule)
  // Safety net for changes the observers can't see (e.g. skin swaps resizing windows).
  setInterval(schedule, 500)
  schedule()
  return schedule
}

/**
 * Moves the whole window by its title bars. Webamp's own in-page dragging is disabled:
 * the OS window follows the pointer instead, so it can cross to another display.
 */
export function enableNativeDrag(): void {
  let dragging = false
  window.addEventListener(
    'mousedown',
    (event) => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement
      const webampHandle = target.classList.contains('draggable') && target.closest('#webamp') !== null
      const panelHandle = target.closest('.ml-titlebar') !== null && target.closest('button, input, select, a') === null
      if (!webampHandle && !panelHandle) return
      event.stopPropagation()
      dragging = true
      window.remote.dragWindow('start')
    },
    true
  )
  const end = (): void => {
    if (!dragging) return
    dragging = false
    window.remote.dragWindow('end')
  }
  window.addEventListener('mouseup', end, true)
  window.addEventListener('blur', end)
}
