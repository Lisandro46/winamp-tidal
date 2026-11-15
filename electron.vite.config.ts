import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: {
      rollupOptions: {
        // ytmusic: the hidden YouTube Music window (macOS Web Audio backend).
        input: { index: resolve('src/preload/index.ts'), ytmusic: resolve('src/preload/ytmusic.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html'), visualizer: resolve('src/renderer/visualizer.html') }
      }
    }
  }
})
