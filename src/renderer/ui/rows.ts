import type { Collection, Track } from '@shared/types'
import { favorites } from './library'

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
}

const actionButtons = ({ play, add }: RowActions, what: string): HTMLElement =>
  el(
    'span',
    { className: 'row-actions' },
    el('button', { className: 'row-play', textContent: '▶', title: `Reproducir ${what}`, onclick: stop(play) }),
    el('button', { className: 'row-add', textContent: '+', title: `Agregar ${what} a la playlist`, onclick: stop(add) })
  )

export function trackRow(track: Track, index: number, actions: RowActions, likeEnabled: boolean): HTMLElement {
  const heart = heartButton(track.id, likeEnabled)
  heart.dataset.trackId = track.id
  const row = el(
    'div',
    { className: 'ml-track', title: 'Doble click: reproducir', ondblclick: () => actions.play() },
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

export function collectionRow(collection: Collection, open: () => void, actions?: RowActions): HTMLElement {
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
    ...(actions ? [actionButtons(actions, KIND_LABEL[collection.kind])] : [])
  )
}
