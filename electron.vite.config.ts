import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    server: {
      // 避开常见 5173 被其它 Vite 项目占用，减少「dev 起了但 Electron 连错/卡住」
      port: 5188,
      strictPort: false
    },
    plugins: [react()]
  }
})
