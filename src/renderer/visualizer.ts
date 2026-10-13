/**
 * Full-screen Milkdrop (Butterchurn) on one monitor, fed with the same captured
 * system audio as the Winamp windows. Esc or double click closes it;
 * Space / → next preset, ← previous, R toggles random cycling.
 */

import butterchurn from 'butterchurn'
import presetPack from 'butterchurn-presets'
import { PcmAnalyser } from './webamp/pcmAnalyser'

const CYCLE_MS = 20_000
const BLEND_S = 2.7
const PRESET_LABEL_MS = 3000

const presets = (presetPack as unknown as { default?: Record<string, object> }).default ?? presetPack
const names = Object.keys(presets)

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!
const label = document.querySelector<HTMLElement>('#preset')!

// Butterchurn draws at the canvas's own size, which it doesn't set itself.
function fitCanvas(): void {
  canvas.width = Math.round(innerWidth * devicePixelRatio)
  canvas.height = Math.round(innerHeight * devicePixelRatio)
}
fitCanvas()

const pcm = new PcmAnalyser()
pcm.resume()
const visualizer = butterchurn.createVisualizer(pcm.context, canvas, {
  width: innerWidth,
  height: innerHeight,
  pixelRatio: devicePixelRatio || 1,
  meshWidth: 48,
  meshHeight: 36,
  onlyUseWASM: true
})
visualizer.connectAudio(pcm.analyser)

const history: number[] = []
let current = -1
let cycling = true
let cycleTimer: ReturnType<typeof setTimeout> | undefined
let labelTimer: ReturnType<typeof setTimeout> | undefined

function load(index: number, blend = BLEND_S): void {
  if (!names.length) return
  current = (index + names.length) % names.length
  visualizer.loadPreset(presets[names[current]], blend)
  label.textContent = names[current]
  label.classList.add('visible')
  clearTimeout(labelTimer)
  labelTimer = setTimeout(() => label.classList.remove('visible'), PRESET_LABEL_MS)
  clearTimeout(cycleTimer)
  if (cycling) cycleTimer = setTimeout(() => next(), CYCLE_MS)
}

function next(): void {
  if (current >= 0) history.push(current)
  load(Math.floor(Math.random() * names.length))
}

function previous(): void {
  const index = history.pop()
  if (index != null) load(index, 0)
}

// Start with the preset the Milkdrop window was showing, when it is known.
const initial = names.indexOf(decodeURIComponent(location.hash.slice(1)))
if (initial >= 0) load(initial, 0)
else next()

window.remote.onPcm((chunk) => pcm.feed(chunk))
let lastTitle = ''
window.remote.onState((state) => {
  const title = state ? [state.artist, state.title].filter(Boolean).join(' - ') : ''
  if (title && title !== lastTitle) visualizer.launchSongTitleAnim(title)
  lastTitle = title
})

addEventListener('resize', () => {
  fitCanvas()
  visualizer.setRendererSize(innerWidth, innerHeight)
})
addEventListener('dblclick', () => window.close())
addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.close()
  else if (event.key === ' ' || event.key === 'ArrowRight') next()
  else if (event.key === 'ArrowLeft') previous()
  else if (event.key.toLowerCase() === 'r') {
    cycling = !cycling
    clearTimeout(cycleTimer)
    if (cycling) cycleTimer = setTimeout(() => next(), CYCLE_MS)
  }
})

const frame = (): void => {
  visualizer.render()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
