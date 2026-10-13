import { join } from 'node:path'
import { BrowserWindow, screen, type Point } from 'electron'

let visualizer: BrowserWindow | undefined

/** The full-screen Milkdrop window, while it is open. */
export function visualizerWindow(): BrowserWindow | undefined {
  return visualizer && !visualizer.isDestroyed() ? visualizer : undefined
}

/**
 * Opens Milkdrop full screen on the monitor containing `point` (screen coordinates),
 * starting with `preset` when given. The main window can't go full screen itself:
 * it is a transparent overlay spanning every monitor.
 */
export function openVisualizer(point: Point, preset?: string): void {
  const display = screen.getDisplayNearestPoint(point)
  const open = visualizerWindow()
  if (open) {
    open.setFullScreen(false)
    open.setBounds(display.bounds)
    open.setFullScreen(true)
    open.focus()
    return
  }
  visualizer = new BrowserWindow({
    ...display.bounds,
    frame: false,
    fullscreen: true,
    backgroundColor: '#000000',
    title: 'Milkdrop',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  visualizer.on('closed', () => (visualizer = undefined))
  const hash = preset ? encodeURIComponent(preset) : ''
  if (process.env.ELECTRON_RENDERER_URL) {
    void visualizer.loadURL(`${process.env.ELECTRON_RENDERER_URL}/visualizer.html#${hash}`)
  } else {
    void visualizer.loadFile(join(__dirname, '../renderer/visualizer.html'), { hash })
  }
}
