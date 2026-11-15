import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

/**
 * Native macOS menu bar. Items just fire the same DOM events the in-page UI uses,
 * so the menu and the Media Library buttons stay in sync with no extra IPC.
 */
export function installMacMenu(window: BrowserWindow): void {
  const fire = (event: string): void => {
    if (window.isDestroyed()) return
    void window.webContents.executeJavaScript(`document.dispatchEvent(new CustomEvent(${JSON.stringify(event)}))`)
  }
  // No accelerators: on macOS a menu key equivalent without a modifier swallows the letter
  // everywhere (typing an "l" in the search box would toggle the library). L and J are handled
  // by the page, which ignores them while a text field has focus; the label only shows the hint.
  const item = (label: string, event: string): MenuItemConstructorOptions => ({
    label,
    click: () => fire(event)
  })

  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'Cuenta',
      submenu: [
        item('Iniciar sesión en YouTube Music…', 'auth:login'),
        item('Cerrar sesión', 'auth:logout'),
        { type: 'separator' },
        item('Servicio y credenciales…', 'setup:open')
      ]
    },
    { role: 'editMenu' },
    {
      label: 'Ver',
      submenu: [
        item('Mostrar/ocultar Biblioteca (L)', 'library:show-toggle'),
        item('Buscar en YouTube Music… (J)', 'search:open'),
        item('Skins…', 'skins:open'),
        item('Milkdrop', 'milkdrop:toggle'),
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  app.setName('Winamp Remote')
}
