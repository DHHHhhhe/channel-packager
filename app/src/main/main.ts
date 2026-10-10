import { app, BrowserWindow, dialog, session, shell } from 'electron'
import path from 'node:path'
import { registerClipboardIpc } from './ipc/clipboard'
import { registerCredentialIpc } from './ipc/credential'
import { registerDialogIpc } from './ipc/dialog'
import { registerRuntimeIpc } from './ipc/runtime'
import { registerStoreIpc } from './ipc/store'
import { registerTaskIpc } from './ipc/task'
import { registerPackIpc } from './ipc/pack'
import { registerShellIpc } from './ipc/shell'
import { installApplicationMenu } from './menu'
import { initPaths } from './paths'
import { currentBackgroundColor, initTheme } from './theme'
import { initUpdater, registerUpdateIpc } from './updater'
import type { ThemeChoice } from '../shared/types/settings'

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

function createWindow(theme: ThemeChoice): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    // 跟当前主题一致，否则深色下首帧之前会闪一下白
    backgroundColor: currentBackgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // preload 用 CJS require('electron') 取 webUtils，沙箱下拿不到
      sandbox: false,
      // 渲染层要在第一帧之前就知道选的是哪一档，异步问一遍来不及
      additionalArguments: [
        `--dsh-theme=${theme}`,
        // 侧边栏底部要显示版本号：自动更新之后用户得能看出确实换了版本
        `--dsh-version=${app.getVersion()}`,
      ],
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
  registerCredentialIpc()
  registerTaskIpc()
  registerPackIpc()
  registerClipboardIpc()
  registerShellIpc()
  registerDialogIpc()
  registerUpdateIpc()

  // 建窗口之前定下主题：底色与渲染层的 prefers-color-scheme 都取它
  const theme = initTheme()

  // 自带菜单是英文的，还带着「重新加载」；换成自己的那份
  installApplicationMenu()

  createWindow(theme)

  // 查更新要联网，放在窗口起来之后（见 updater.ts 里的延迟）
  initUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(initTheme())
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
