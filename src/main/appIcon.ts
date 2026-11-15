import { app, nativeImage, type BrowserWindowConstructorOptions } from 'electron'
import iconPath from '../../assets/icon.png?asset'

/** The classic Winamp bolt, for every window (and the Dock in development, where the app runs as Electron). */
export const appIcon = nativeImage.createFromPath(iconPath)
export const windowIcon: Pick<BrowserWindowConstructorOptions, 'icon'> = { icon: appIcon }

export function applyDockIcon(): void {
  if (process.platform === 'darwin' && !appIcon.isEmpty()) app.dock?.setIcon(appIcon)
}
