import type { Track } from '@shared/types'

const HISTORY_LIMIT = 500

/**
 * Which song comes after (or before) the current one, for Winamp's SHUF and REP buttons.
 * The app's queue decides: a service's own autoplay never does.
 *
 *  - shuffle: random, without repeating a song until every other one has played;
 *  - repeat: when the list is over, start it again (the whole list, like Winamp);
 *  - previous: goes back through what actually played, not through list positions.
 */
export class PlayOrder {
  shuffle = false
  repeat = false
  /** Ids that already played in this shuffle round. */
  private played = new Set<string>()
  /** Ids in the order they played; the last one is the current song. */
  private history: string[] = []

  /** A new list started: forget the previous round and history. */
  reset(): void {
    this.played.clear()
    this.history = []
  }

  /** Start a new shuffle round; the song playing now counts as played. */
  restartRound(currentId?: string): void {
    this.played.clear()
    if (currentId) this.played.add(currentId)
  }

  /** `id` just started playing. */
  started(id: string): void {
    this.played.add(id)
    if (this.history[this.history.length - 1] !== id) {
      this.history.push(id)
      if (this.history.length > HISTORY_LIMIT) this.history.shift()
    }
  }

  /** Is there a song after the current one (without picking it)? */
  hasNext(queue: Track[], currentId: string | undefined, fallbackIndex = -1): boolean {
    if (!queue.length) return false
    if (this.repeat) return true
    const at = this.position(queue, currentId, fallbackIndex)
    if (!this.shuffle) return at + 1 < queue.length
    return this.candidates(queue, currentId).length > 0
  }

  /** Index of the song to play next, or -1 when the list is over. */
  next(queue: Track[], currentId: string | undefined, fallbackIndex = -1): number {
    if (!queue.length) return -1
    const at = this.position(queue, currentId, fallbackIndex)
    if (!this.shuffle) {
      if (at + 1 < queue.length) return at + 1
      return this.repeat ? 0 : -1
    }
    let pool = this.candidates(queue, currentId)
    if (!pool.length) {
      if (!this.repeat) return -1
      // New round: everything can play again (but not the same song twice in a row, if there is a choice).
      this.played.clear()
      if (currentId) this.played.add(currentId)
      pool = this.candidates(queue, currentId)
      if (!pool.length) return 0
    }
    return pool[Math.floor(Math.random() * pool.length)]
  }

  /** Index of the song that played before the current one, or -1 when there is none. */
  previous(queue: Track[], currentId: string | undefined, fallbackIndex = -1): number {
    // The last history entry is the current song; step back past it (and past anything no longer in the list).
    while (this.history.length > 1) {
      this.history.pop()
      const index = queue.findIndex((t) => t.id === this.history[this.history.length - 1])
      if (index >= 0) return index
    }
    const at = this.position(queue, currentId, fallbackIndex)
    return at > 0 ? at - 1 : -1
  }

  /** Where the current song is in the list; if it was removed, where it used to be (so "next" is the one after it). */
  private position(queue: Track[], currentId: string | undefined, fallbackIndex: number): number {
    const found = currentId ? queue.findIndex((t) => t.id === currentId) : -1
    if (found >= 0) return found
    return Math.max(-1, Math.min(fallbackIndex, queue.length) - 1)
  }

  private candidates(queue: Track[], currentId: string | undefined): number[] {
    const out: number[] = []
    queue.forEach((track, index) => {
      if (track.id !== currentId && !this.played.has(track.id)) out.push(index)
    })
    return out
  }
}
