import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import { registerIpc } from './ipc'
import { smtc } from './smtc/helperClient'

/**
 * The app is a transparent, frameless window covering the desktop's work area.
 * Only the Winamp windows and the Media Library are drawn; everywhere else the
 * mouse passes through to whatever is behind, so they float like real Winamp.
 */
function createWindow(): void {
  const { workArea } = screen.getPrimaryDisplay()
  const window = new BrowserWindow({
    ...workArea,
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

  // Keep covering the work area if the taskbar or resolution changes.
  screen.on('display-metrics-changed', () => {
    if (!window.isDestroyed()) window.setBounds(screen.getPrimaryDisplay().workArea)
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

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  smtc.stop()
  app.quit()
})
