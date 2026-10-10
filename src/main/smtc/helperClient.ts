import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { EventEmitter } from 'node:events'
import { app } from 'electron'
import type { PcmChunk, SystemVolume } from '@shared/types'

/** A Windows media session (any app integrated with the system media controls). */
export interface SmtcSession {
  appId: string
  title: string
  artist: string
  album: string
  isPlaying: boolean
  status: string
  positionMs: number
  durationMs: number
  canSeek: boolean
  thumbnail?: string
}

export type SmtcTarget = 'tidal' | 'any'
export type SmtcCommand =
  | 'play'
  | 'pause'
  | 'toggle'
  | 'stop'
  | 'next'
  | 'previous'
  | 'seek'
  | 'setVolume'
  | 'getVolume'
  | 'visualizer'

interface SessionsMessage {
  type: 'sessions'
  current?: string
  sessions: SmtcSession[]
}
interface VolumeMessage extends SystemVolume {
  type: 'volume'
}
interface PcmMessage extends PcmChunk {
  type: 'pcm'
}
interface ResultMessage {
  type: 'result'
  id: number
  ok: boolean
  error?: string
}

const helperPath = (): string => {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'smtc-helper', 'smtc-helper.exe')]
    : [join(app.getAppPath(), 'build', 'smtc-helper', 'smtc-helper.exe')]
  const found = candidates.find((path) => existsSync(path))
  if (!found) throw new Error(`smtc-helper.exe not found (looked in ${candidates.join(', ')})`)
  return found
}

export function matchesTarget(session: SmtcSession, target: SmtcTarget): boolean {
  const id = session.appId.toLowerCase()
  if (target === 'tidal') return id.includes('tidal') || id.includes('wimpmusic')
  return true
}

/** Talks to native/smtc-helper over stdin/stdout (one JSON message per line). */
class SmtcClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | undefined
  private nextId = 1
  private pending = new Map<number, (result: ResultMessage) => void>()
  private latest: SessionsMessage = { type: 'sessions', sessions: [] }
  private visualizerOn = false

  private ensureRunning(): ChildProcessWithoutNullStreams {
    if (this.child && this.child.exitCode == null) return this.child
    const child = spawn(helperPath(), [], { windowsHide: true })
    child.stderr.on('data', (data) => console.warn('[smtc-helper]', String(data).trim()))
    child.on('exit', () => {
      this.child = undefined
      for (const resolve of this.pending.values()) {
        resolve({ type: 'result', id: 0, ok: false, error: 'smtc-helper exited' })
      }
      this.pending.clear()
    })
    createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(line))
    this.child = child
    // A restarted helper must resume the capture the UI asked for.
    if (this.visualizerOn) child.stdin.write(JSON.stringify({ cmd: 'visualizer', enabled: true }) + '\n')
    return child
  }

  private handleLine(line: string): void {
    let message: SessionsMessage | ResultMessage | VolumeMessage | PcmMessage
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (message.type === 'sessions') {
      this.latest = message
      this.emit('sessions', message)
    } else if (message.type === 'volume') {
      this.emit('volume', { volume: message.volume, muted: message.muted, device: message.device })
    } else if (message.type === 'pcm') {
      this.emit('pcm', { rate: message.rate, data: message.data })
    } else if (message.type === 'result') {
      this.pending.get(message.id)?.(message)
      this.pending.delete(message.id)
    }
  }

  start(): void {
    this.ensureRunning()
  }

  /** Current session for `target` from the latest snapshot. */
  session(target: SmtcTarget): SmtcSession | undefined {
    const { sessions, current } = this.latest
    if (target === 'any') return sessions.find((s) => s.appId === current) ?? sessions[0]
    return sessions.find((s) => matchesTarget(s, target))
  }

  onSessions(listener: () => void): () => void {
    this.start()
    this.on('sessions', listener)
    return () => this.off('sessions', listener)
  }

  onVolume(listener: (volume: SystemVolume) => void): () => void {
    this.on('volume', listener)
    void this.send('getVolume', 'any').catch(() => undefined)
    return () => this.off('volume', listener)
  }

  onPcm(listener: (chunk: PcmChunk) => void): () => void {
    this.on('pcm', listener)
    return () => this.off('pcm', listener)
  }

  setVisualizer(enabled: boolean): Promise<void> {
    this.visualizerOn = enabled
    return this.send('visualizer', 'any', { enabled })
  }

  setVolume(volume: number): Promise<void> {
    return this.send('setVolume', 'any', { volume: Math.round(volume) })
  }

  async send(
    cmd: SmtcCommand,
    target: SmtcTarget,
    extra: { positionMs?: number; volume?: number; enabled?: boolean } = {}
  ): Promise<void> {
    const child = this.ensureRunning()
    const id = this.nextId++
    const result = await new Promise<ResultMessage>((resolve) => {
      this.pending.set(id, resolve)
      child.stdin.write(JSON.stringify({ id, cmd, target, ...extra }) + '\n')
    })
    if (!result.ok) throw new Error(result.error ?? `${cmd} failed`)
  }

  stop(): void {
    this.child?.kill()
  }
}

export const smtc = new SmtcClient()
