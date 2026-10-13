import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, screen, shell, type Rectangle } from 'electron'
import type { DesktopLayout } from '@shared/types'
import { settingsStore } from './auth/store'
import { registerIpc } from './ipc'
import { handleSkinScheme, registerSkinScheme } from './skins'
import { smtc } from './smtc/helperClient'

/** Bounding box of every monitor's work area (the window spans all of them). */
function desktopBounds(): Rectangle {
  const areas = screen.getAllDisplays().map((d) => d.workArea)
  const left = Math.min(...areas.map((a) => a.x))
  const top = Math.min(...areas.map((a) => a.y))
  const right = Math.max(...areas.map((a) => a.x + a.width))
  const bottom = Math.max(...areas.map((a) => a.y + a.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Zoom steps for the whole UI (Winamp windows and panels). */
const SCALES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]

const currentScale = (): number => settingsStore.get().scale ?? 1

/**
 * Primary monitor's work area relative to the window, so the UI starts there.
 * In CSS pixels: the page is zoomed by the UI scale, so screen pixels are divided by it.
 */
function layout(): DesktopLayout {
  const bounds = desktopBounds()
  const scale = currentScale()
  const toCss = (a: Rectangle): Rectangle => ({
    x: (a.x - bounds.x) / scale,
    y: (a.y - bounds.y) / scale,
    width: a.width / scale,
    height: a.height / scale
  })
  return {
    primary: toCss(screen.getPrimaryDisplay().workArea),
    displays: screen.getAllDisplays().map((d) => toCss(d.workArea)),
    scale
  }
}

function nextScale(direction: 'in' | 'out' | 'reset'): number {
  if (direction === 'reset') return 1
  const scale = currentScale()
  if (direction === 'in') return SCALES.find((s) => s > scale + 0.001) ?? SCALES[SCALES.length - 1]
  return [...SCALES].reverse().find((s) => s < scale - 0.001) ?? SCALES[0]
}

/**
 * The app is a transparent, frameless window covering every monitor's work area.
 * Only the Winamp windows and the Media Library are drawn; everywhere else the
 * mouse passes through to whatever is behind, so they float like real Winamp.
 */
function createWindow(): void {
  const window = new BrowserWindow({
    ...desktopBounds(),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Winamp Remote',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      // The visualizer's AudioContext must run without a click first.
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  window.setIgnoreMouseEvents(true, { forward: true })

  // The renderer reports whether the pointer is over a Winamp window or the library.
  ipcMain.on('window:interactive', (_event, interactive: boolean) => {
    if (!window.isDestroyed()) window.setIgnoreMouseEvents(!interactive, { forward: true })
  })

  ipcMain.handle('window:layout', () => layout())

  // Keep covering every monitor when one is added, removed, rotated or rescaled.
  const refit = (): void => {
    if (window.isDestroyed()) return
    window.setBounds(desktopBounds())
    window.webContents.send('window:layout', layout())
  }
  screen.on('display-metrics-changed', refit)
  screen.on('display-added', refit)
  screen.on('display-removed', refit)

  // UI size: Ctrl +/-/0, Ctrl+wheel or the Media Library buttons zoom the whole page.
  const applyScale = (): void => window.webContents.setZoomFactor(currentScale())
  window.webContents.on('did-finish-load', applyScale)
  const rescale = (direction: 'in' | 'out' | 'reset'): void => {
    settingsStore.update({ scale: nextScale(direction) })
    applyScale()
    refit()
  }
  ipcMain.on('window:scale', (_event, direction: 'in' | 'out' | 'reset') => rescale(direction))
  window.webContents.on('zoom-changed', (_event, direction) => rescale(direction))
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt) return
    const keys: Record<string, 'in' | 'out' | 'reset'> = { '+': 'in', '=': 'in', '-': 'out', '0': 'reset' }
    const direction = keys[input.key]
    if (!direction) return
    // Also stops the default menu's own zoom accelerators.
    event.preventDefault()
    rescale(direction)
  })

  // Links inside the UI open in the system browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const dispose = registerIpc(window)
  window.on('closed', dispose)

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

registerSkinScheme()
app.whenReady().then(() => {
  handleSkinScheme()
  createWindow()
})
app.on('window-all-closed', () => {
  smtc.stop()
  app.quit()
})
