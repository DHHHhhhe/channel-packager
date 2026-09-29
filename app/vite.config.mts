import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const appRoot = path.dirname(fileURLToPath(import.meta.url))
const rendererRoot = path.join(appRoot, 'src', 'renderer')

export default defineConfig(async () => ({
  root: rendererRoot,
  // 打包后由 file:// 加载，必须用相对路径
  base: './',
  resolve: {
    alias: {
      '@': path.join(rendererRoot, 'src'),
      '@shared': path.join(appRoot, 'src', 'shared'),
    },
  },
  build: {
    // 绝对路径：root 已指向 src/renderer，相对路径会落到 src/renderer/dist
    outDir: path.join(appRoot, 'dist'),
    emptyOutDir: true,
  },
  plugins: [
    react(),
    tailwindcss(),
    await electron({
      main: {
        entry: 'src/main/main.ts',
        // vite-plugin-electron 会把外层 root 继承给主/预加载构建
        // （options.vite.root ??= userConfig.root）。外层 root 是 src/renderer，
        // 不在这里改回 app 根目录，入口与 dist-electron 都会解析到错误位置。
        vite: { root: appRoot },
      },
      preload: {
        input: 'src/preload/preload.ts',
        vite: { root: appRoot },
      },
    }),
  ],
}))
