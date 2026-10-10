import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, screen, shell, type Rectangle } from 'electron'
import type { DesktopLayout } from '@shared/types'
import { registerIpc } from './ipc'
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

/** Primary monitor's work area relative to the window, so the UI starts there. */
function layout(): DesktopLayout {
  const bounds = desktopBounds()
  const { workArea } = screen.getPrimaryDisplay()
  return {
    primary: { ...workArea, x: workArea.x - bounds.x, y: workArea.y - bounds.y },
    displays: screen.getAllDisplays().map(({ workArea: a }) => ({ ...a, x: a.x - bounds.x, y: a.y - bounds.y }))
  }
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

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  smtc.stop()
  app.quit()
})
