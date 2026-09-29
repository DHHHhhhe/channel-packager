import { app, BrowserWindow, dialog, session, shell } from 'electron'
import path from 'node:path'
import { registerRuntimeIpc } from './ipc/runtime'
import { registerStoreIpc } from './ipc/store'
import { initPaths } from './paths'

/** dev 时由 vite-plugin-electron 注入；打包后不存在 */
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

// 必须在 ready 之前：app.setPath('userData') 要在此前生效，否则 Chromium 缓存会另落一份到 %APPDATA%
try {
  initPaths()
} catch (error) {
  dialog.showErrorBox(
    '无法初始化数据目录',
    error instanceof Error ? error.message : String(error),
  )
  app.exit(1)
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // preload 用 CJS require('electron') 取 webUtils，沙箱下拿不到
      sandbox: false,
    },
  })

  // 等首帧渲染完再显示，避免白屏闪一下
  win.once('ready-to-show', () => {
    win.show()
  })

  // 外链一律交给系统浏览器，不在应用内开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function applyProductionCsp(): void {
  // dev 下 @vitejs/plugin-react 会注入内联的 refresh 前导脚本，
  // 严格 CSP 会直接把它拦掉，因此只在打包后启用。
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:",
        ],
      },
    })
  })
}

app.whenReady().then(() => {
  if (!DEV_SERVER_URL) {
    applyProductionCsp()
  }

  // 先注册 IPC，再建窗口：渲染层挂载时就会查运行时，晚了会拿到空结果
  registerRuntimeIpc()
  registerStoreIpc()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
