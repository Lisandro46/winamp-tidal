import type { PlaylistChoice, Track } from '@shared/types'
import '../styles/actions.css'
import { library } from './library'
import { el } from './rows'
import { toast } from './toast'

/**
 * "Agregar a playlist…": a small chooser drawn over the window that asked for it. Lists the
 * user's own YouTube Music playlists plus "Nueva playlist…", and adds the track(s) to the pick.
 */
class PlaylistPicker {
  private readonly root = el('div', { className: 'pl-overlay hidden' })
  private readonly what = el('div', { className: 'pl-what' })
  private readonly list = el('div', { className: 'pl-list' })
  private readonly note = el('div', { className: 'pl-note' })
  private ids: string[] = []
  private busy = false

  constructor(host: HTMLElement) {
    this.root.append(
      el(
        'div',
        { className: 'pl-box' },
        el(
          'div',
          { className: 'ml-titlebar' },
          el('span', {}, 'AGREGAR A PLAYLIST'),
          el('div', { className: 'ml-titlebar-actions' }, el('button', { textContent: '×', title: 'Cerrar (Esc)', onclick: () => this.close() }))
        ),
        this.what,
        this.list,
        this.note
      )
    )
    host.append(this.root)
    // Esc closes just this chooser, and keystrokes here never reach Webamp's hotkeys.
    this.root.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Escape') this.close()
    })
    this.root.addEventListener('mousedown', (event) => {
      if (event.target === this.root) this.close()
    })
  }

  close(): void {
    this.root.classList.add('hidden')
  }

  async open(what: string, getTracks: () => Promise<Track[]>): Promise<void> {
    this.root.classList.remove('hidden')
    this.what.textContent = what
    this.note.textContent = ''
    this.ids = []
    this.list.replaceChildren(el('div', { className: 'pl-note' }, 'Cargando tus playlists…'))
    try {
      const tracks = await getTracks()
      this.ids = [...new Set(tracks.map((t) => t.id))]
      if (!this.ids.length) {
        this.list.replaceChildren(el('div', { className: 'pl-note' }, 'No hay temas para agregar.'))
        return
      }
      this.what.textContent = this.ids.length > 1 ? `${what} (${this.ids.length} temas)` : what
      this.render(await window.remote.getEditablePlaylists(this.ids))
    } catch {
      // the error toast already says why (e.g. not signed in)
      this.list.replaceChildren(el('div', { className: 'pl-note' }, 'No se pudieron cargar tus playlists.'))
    }
  }

  private render(choices: PlaylistChoice[]): void {
    const name = el('input', { className: 'ml-search pl-name', placeholder: 'Nombre de la nueva playlist', maxLength: 150 })
    const create = (): void => void this.create(name.value)
    name.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') create()
    })
    this.list.replaceChildren(
      el('div', { className: 'pl-new' }, name, el('button', { textContent: 'Crear', title: 'Crear la playlist con estos temas', onclick: create })),
      ...(choices.length
        ? choices.map((choice) =>
            el(
              'button',
              {
                className: 'pl-row',
                title: `Agregar a "${choice.name}"`,
                onclick: () => void this.add(choice)
              },
              el('span', { className: 'pl-row-name' }, choice.name)
            )
          )
        : [el('div', { className: 'pl-note' }, 'Todavía no tenés playlists propias. Escribí un nombre arriba para crear una.')])
    )
    name.focus()
  }

  private async run(job: () => Promise<string>): Promise<void> {
    if (this.busy) return
    this.busy = true
    this.list.classList.add('busy')
    try {
      toast(await job())
      library.invalidate('playlists')
      this.close()
    } catch {
      // the error toast explains what went wrong; the chooser stays open to try again
    } finally {
      this.busy = false
      this.list.classList.remove('busy')
    }
  }

  private add(choice: PlaylistChoice): Promise<void> {
    return this.run(async () => {
      const added = await window.remote.addToPlaylist(choice.id, this.ids)
      if (!added) return `${this.ids.length > 1 ? 'Ya estaban' : 'Ya estaba'} en "${choice.name}"`
      return added > 1 ? `${added} temas agregados a "${choice.name}"` : `Agregado a "${choice.name}"`
    })
  }

  private create(name: string): Promise<void> {
    if (!name.trim()) {
      this.note.textContent = 'Escribí un nombre para la playlist.'
      return Promise.resolve()
    }
    return this.run(async () => `Playlist "${(await window.remote.createPlaylist(name, this.ids)).name}" creada`)
  }
}

const pickers = new WeakMap<HTMLElement, PlaylistPicker>()

/** Opens the chooser inside `host` (the dialog the user is in) for the tracks `getTracks` resolves. */
export function openPlaylistPicker(host: HTMLElement, what: string, getTracks: () => Promise<Track[]>): void {
  let picker = pickers.get(host)
  if (!picker) {
    picker = new PlaylistPicker(host)
    pickers.set(host, picker)
  }
  void picker.open(what, getTracks)
}
