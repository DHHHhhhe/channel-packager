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
import { initVersionNotice } from './version-notice'
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

/**
 * 单实例。
 *
 * 第二个实例不开新窗口，而是把已经在跑的那个拉到前台 —— 同时开两份没有任何好处：
 * 它们写的是同一份 data 目录，出包任务也会互相抢输出文件。
 *
 * 这个锁认的是 userData 目录，所以必须放在 initPaths() **之后**：那一步才把
 * userData 定到 data 目录，早申请的话锁会落在默认的 %APPDATA% 上，跟运行时
 * 真正用的目录不是同一个 —— 锁看起来拿到了，却挡不住真正该挡的那个实例。
 *
 * 拿不到锁就直接退，不再往下走（不注册 IPC、不建窗口）。
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  /**
   * 把已有窗口唤到前台。
   *
   * 顺序有讲究：先 restore 再 focus。最小化状态下直接 focus() 不会把它弹出来，
   * Windows 上只会看到任务栏图标闪一下、窗口不动。
   *
   * 这里不调 show()：窗口要么已经显示，要么还在等自己的 ready-to-show ——
   * 在后者之前 show() 会先亮一帧白屏，比什么都不做更难看。
   */
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (!win) {
      return
    }
    if (win.isMinimized()) {
      win.restore()
    }
    /*
     * 临时置顶再取消，才能真的把窗口顶到最前。
     *
     * Windows 有前台抢占保护：focus() 底下调的是 SetForegroundWindow，只在调用进程
     * 本来就是前台进程时才生效。而这里我们是后台进程 —— 用户点的是第二个实例，
     * 它拿不到锁就把活交给了我们，那份「允许抢前台」的许可没跟着转过来。
     * 实测只调 focus() 的结果是任务栏图标闪一下、窗口不动。
     *
     * 置顶不走这条限制，取消置顶后窗口回到正常层级，不会一直压着别人。
     */
    win.setAlwaysOnTop(true)
    win.focus()
    app.focus({ steal: true })
    win.setAlwaysOnTop(false)
  })

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

    /*
     * 建窗口之前记下版本变化。渲染层一挂载就会来取「刚更新过」的提示，
     * 晚了它取到的是空 —— 而那条提示是用户确认更新装成功了的唯一依据：
     * 安装那几十秒应用是关着的，他看不到任何界面。
     */
    initVersionNotice()

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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
