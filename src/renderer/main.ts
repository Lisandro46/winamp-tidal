import Webamp from 'webamp'
import './styles/app.css'
import { getRemoteMedia, RemoteMedia } from './webamp/RemoteMedia'
import { RemoteController } from './webamp/controller'
import { LibraryPanel } from './ui/LibraryPanel'

const $ = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!

function showToast(message: string): void {
  const toast = $('#toast')
  toast.textContent = message
  toast.classList.add('visible')
  clearTimeout(Number(toast.dataset.timer))
  toast.dataset.timer = String(setTimeout(() => toast.classList.remove('visible'), 6000))
}

function setupTitlebar(webamp: Webamp): void {
  $('#btn-minimize').onclick = () => window.remote.windowControl('minimize')
  $('#btn-close').onclick = () => window.remote.windowControl('close')
  $('#btn-library').onclick = () => document.dispatchEvent(new CustomEvent('library:toggle'))

  const fileInput = $<HTMLInputElement>('#skin-file')
  $('#btn-skin').onclick = () => fileInput.click()
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
  $('#btn-skin-reset').onclick = () => {
    void window.remote.setSkin(undefined)
    location.reload()
  }
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

  let library: LibraryPanel | undefined
  const controller = new RemoteController(webamp, (status) => library?.setEqStatus(status))
  window.remote.onState((state) => controller.applyState(state))
  window.remote.onVolume((volume) => controller.applyVolume(volume))
  window.remote.onPcm((chunk) => getRemoteMedia()?.feedPcm(chunk))
  window.remote.onError((message) => showToast(message))

  setupTitlebar(webamp)
  await webamp.renderInto($('#stage'))
  controller.restoreEq(settings.eq)

  library = new LibraryPanel($('#library'), controller)
  await library.init()
  await window.remote.ready()
}

void main()
