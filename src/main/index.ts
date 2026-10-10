import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { registerIpc } from './ipc'
import { smtc } from './smtc/helperClient'

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    backgroundColor: '#000000',
    title: 'Winamp Remote',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      // The visualizer's (silent) AudioContext must run without a click first.
      autoplayPolicy: 'no-user-gesture-required'
    }
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
