import type { Collection, Track } from '@shared/types'
import { isSavable, savedKeyOf } from '@shared/saved'
import { favorites } from './library'
import { saved } from './saved'

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node, props)
  node.append(...children)
  return node
}

export const formatDuration = (ms: number): string => {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const stop =
  (fn: () => void) =>
  (event: MouseEvent): void => {
    event.stopPropagation()
    fn()
  }

export function heartButton(trackId: string | undefined, enabled: boolean): HTMLButtonElement {
  const liked = trackId != null && favorites.ids.has(trackId)
  return el('button', {
    className: `ml-heart ${liked ? 'liked' : ''}`,
    textContent: liked ? '♥' : '♡',
    title: liked ? 'Quitar de favoritos' : 'Agregar a favoritos',
    disabled: trackId == null || !enabled,
    onclick: stop(() => trackId && favorites.toggle(trackId))
  })
}

/** Replaces every heart inside `root` so it reflects the current favorites. */
export function refreshHearts(root: HTMLElement, enabled: boolean): void {
  for (const heart of root.querySelectorAll<HTMLElement>('.ml-heart[data-track-id]')) {
    const next = heartButton(heart.dataset.trackId, enabled)
    next.dataset.trackId = heart.dataset.trackId
    heart.replaceWith(next)
  }
}

export interface RowActions {
  play(): void
  add(): void
  /** "Agregar a playlist…" (YouTube Music, signed in). */
  playlist?(): void
}

const SAVE_TITLES: Record<Collection['kind'], [string, string]> = {
  album: ['Guardar el álbum en tu biblioteca', 'Quitar el álbum de tu biblioteca'],
  playlist: ['Guardar la playlist en tu biblioteca', 'Quitar la playlist de tu biblioteca'],
  artist: ['Seguir al artista', 'Dejar de seguir al artista'],
  mix: ['', '']
}

const paintSave = (button: HTMLElement, kind: Collection['kind'], on: boolean): void => {
  button.classList.toggle('liked', on)
  button.textContent = on ? '♥' : '♡'
  button.title = SAVE_TITLES[kind][on ? 1 : 0]
}

/** Heart of an album, artist or playlist: saved in the user's library (like the heart of a song). */
export function saveButton(collection: Collection, enabled: boolean): HTMLButtonElement {
  const button = el('button', {
    className: 'ml-heart ml-save',
    disabled: !enabled,
    onclick: stop(() => void saved.toggle(collection))
  })
  button.dataset.saveKey = savedKeyOf(collection)
  button.dataset.kind = collection.kind
  paintSave(button, collection.kind, saved.has(collection))
  if (!enabled) button.title = 'Iniciá sesión para guardar en tu biblioteca'
  return button
}

/** Repaints every album/artist/playlist heart inside `root` from the saved state. */
export function refreshSaved(root: HTMLElement): void {
  for (const button of root.querySelectorAll<HTMLElement>('.ml-save[data-save-key]')) {
    if (!(button as HTMLButtonElement).disabled) {
      paintSave(button, button.dataset.kind as Collection['kind'], saved.keys.has(button.dataset.saveKey ?? ''))
    }
  }
}

const actionButtons = ({ play, add, playlist }: RowActions, what: string): HTMLElement =>
  el(
    'span',
    { className: 'row-actions' },
    el('button', { className: 'row-play', textContent: '▶', title: `Reproducir ${what}`, onclick: stop(play) }),
    el('button', { className: 'row-add', textContent: '+', title: `Agregar ${what} a la playlist del Winamp`, onclick: stop(add) }),
    ...(playlist
      ? [el('button', { className: 'row-pl', textContent: '☰', title: `Agregar ${what} a una playlist de YouTube Music…`, onclick: stop(playlist) })]
      : [])
  )

export function trackRow(track: Track, index: number, actions: RowActions, likeEnabled: boolean): HTMLElement {
  const heart = heartButton(track.id, likeEnabled)
  heart.dataset.trackId = track.id
  const row = el(
    'div',
    { className: actions.playlist ? 'ml-track has-pl' : 'ml-track', title: 'Doble click: reproducir', ondblclick: () => actions.play() },
    el('span', { className: 'n' }, String(index + 1)),
    heart,
    el('span', { className: 't' }, track.title),
    el('span', { className: 'a' }, track.artist),
    el('span', { className: 'd' }, formatDuration(track.durationMs)),
    actionButtons(actions, 'el tema')
  )
  row.dataset.trackId = track.id
  return row
}

const KIND_LABEL: Record<Collection['kind'], string> = {
  album: 'el álbum',
  playlist: 'la playlist',
  mix: 'el mix',
  artist: 'los temas del artista'
}

export interface CollectionRowOptions {
  /** Show the save/follow heart (YouTube Music). */
  save?: boolean
  /** The heart works (signed in). */
  enabled?: boolean
}

export function collectionRow(
  collection: Collection,
  open: () => void,
  actions?: RowActions,
  options: CollectionRowOptions = {}
): HTMLElement {
  return el(
    'div',
    { className: 'ml-collection', title: 'Click: ver temas', onclick: open },
    collection.artworkUrl
      ? el('img', { src: collection.artworkUrl, alt: '', loading: 'lazy' })
      : el('div', { className: 'ml-cover-placeholder' }, collection.kind === 'artist' ? '☺' : '♫'),
    el(
      'div',
      { className: 'ml-collection-text' },
      el('div', { className: 'name' }, collection.name),
      el(
        'div',
        { className: 'sub' },
        [collection.subtitle, collection.trackCount != null ? `${collection.trackCount} temas` : '']
          .filter(Boolean)
          .join(' · ')
      )
    ),
    ...(options.save && isSavable(collection.kind) ? [saveButton(collection, options.enabled ?? false)] : []),
    ...(actions ? [actionButtons(actions, KIND_LABEL[collection.kind])] : [])
  )
}
