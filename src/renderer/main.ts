// Webamp plus the Milkdrop (Butterchurn) window and its built-in presets.
import Webamp from 'webamp/butterchurn'
import './styles/app.css'
import { getRemoteMedia, RemoteMedia } from './webamp/RemoteMedia'
import { RemoteController } from './webamp/controller'
import { LibraryPanel, type SkinActions } from './ui/LibraryPanel'
import { SearchDialog } from './ui/SearchDialog'
import { SetupDialog } from './ui/SetupDialog'
import { favorites } from './ui/library'
import { keepOnScreen, keepWebampOnScreen, placeOnPrimary, trackPointer, updateLayout } from './ui/desktop'

const $ = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!

function showToast(message: string): void {
  const toast = $('#toast')
  toast.textContent = message
  toast.classList.add('visible')
  clearTimeout(Number(toast.dataset.timer))
  toast.dataset.timer = String(setTimeout(() => toast.classList.remove('visible'), 6000))
}

function skinActions(webamp: Webamp): SkinActions {
  const fileInput = $<HTMLInputElement>('#skin-file')
  fileInput.onchange = () => {
    const file = fileInput.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      webamp.setSkinFromUrl(dataUrl)
      void window.remote.setSkin(dataUrl)
    }
    reader.readAsDataURL(file)
    fileInput.value = ''
  }
  return {
    pick: () => fileInput.click(),
    reset: () => {
      void window.remote.setSkin(undefined)
      location.reload()
    }
  }
}

interface MilkdropState {
  display: 'WINDOW' | 'DESKTOP' | 'FULLSCREEN'
  presets: { name: string }[]
  currentPresetIndex: number | null
}

/**
 * Milkdrop's own full screen would enlarge this overlay across every monitor,
 * so it opens a separate full-screen window on the monitor under the Milkdrop window.
 */
function redirectMilkdropFullscreen(webamp: Webamp): void {
  const store = webamp.store as unknown as {
    getState(): { milkdrop: MilkdropState }
    dispatch(action: object): void
    subscribe(listener: () => void): () => void
  }
  store.subscribe(() => {
    const milkdrop = store.getState().milkdrop
    if (milkdrop.display !== 'FULLSCREEN') return
    store.dispatch({ type: 'SET_MILKDROP_FULLSCREEN', enabled: false })
    const rect = document.querySelector('#webamp .gen-window')?.getBoundingClientRect()
    const point = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 }
    const preset = milkdrop.currentPresetIndex != null ? milkdrop.presets[milkdrop.currentPresetIndex]?.name : undefined
    void window.remote.openVisualizer(point, preset)
  })
}

async function main(): Promise<void> {
  if (!Webamp.browserIsSupported()) {
    document.body.textContent = 'Webamp no es compatible con este entorno.'
    return
  }
  const settings = await window.remote.getSettings()

  const webamp = new Webamp({
    ...(settings.skinUrl ? { initialSkin: { url: settings.skinUrl } } : {}),
    enableHotkeys: true,
    zIndex: 10,
    __customMediaClass: RemoteMedia
  } as ConstructorParameters<typeof Webamp>[0])

  // Webamp's own close/minimize buttons act on the app window.
  webamp.onWillClose((cancel) => {
    cancel()
    window.remote.windowControl('close')
  })
  webamp.onMinimize(() => window.remote.windowControl('minimize'))
  redirectMilkdropFullscreen(webamp)
  document.addEventListener('milkdrop:toggle', () =>
    webamp.store.dispatch({ type: 'TOGGLE_WINDOW', windowId: 'milkdrop' } as Parameters<typeof webamp.store.dispatch>[0])
  )

  let library: LibraryPanel | undefined
  const controller = new RemoteController(webamp, (status) => library?.setEqStatus(status))
  window.remote.onState((state) => controller.applyState(state))
  window.remote.onVolume((volume) => controller.applyVolume(volume))
  window.remote.onPcm((chunk) => getRemoteMedia()?.feedPcm(chunk))
  window.remote.onError((message) => showToast(message))

  trackPointer()
  // The window spans every monitor; start the UI on the primary one.
  const layout = await window.remote.getLayout()
  placeOnPrimary($('#stage'), $('#library'), layout)
  const recheckWebamp = keepWebampOnScreen(webamp as unknown as Parameters<typeof keepWebampOnScreen>[0])
  let scale = layout.scale
  window.remote.onLayout((next) => {
    updateLayout($('#stage'), $('#library'), next)
    keepOnScreen($('#tidal-search'))
    keepOnScreen($('#tidal-setup'))
    // After a zoom change windows may have grown past the screen edge.
    requestAnimationFrame(recheckWebamp)
    if (next.scale !== scale) showToast(`Tamaño ${Math.round(next.scale * 100)}%`)
    scale = next.scale
  })
  // Centered over the primary monitor's #stage but bounded by the whole window,
  // so the Winamp windows can be dragged onto any monitor.
  await webamp.renderWhenReady($('#stage'))
  controller.restoreEq(settings.eq)

  library = new LibraryPanel($('#library'), controller, skinActions(webamp))
  new SearchDialog($('#tidal-search'), controller)
  const setup = new SetupDialog($('#tidal-setup'))
  window.remote.onLiked((ids) => favorites.set(ids))
  await library.init()
  await window.remote.ready()
  // First run of an installer (no TIDAL app baked in): ask how it will be used.
  if (!settings.setupDone && !(await window.remote.getAuth()).configured) void setup.open()
}

void main()
