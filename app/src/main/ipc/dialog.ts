import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/channels'

/**
 * 目录选择交给主进程。
 *
 * 渲染层拿不到真实路径（contextIsolation），而输出目录这类值本来就不该靠人
 * 手打一串 `D:\...`：中文路径、反斜杠、末尾空格都可能打错，错了要到出包时
 * 才发现。返回 null 表示用户取消 —— 与「选了个空目录」区分开。
 */
export function registerDialogIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.dialogPickDirectory,
    async (_event, title: string, defaultPath: string): Promise<string | null> => {
      const window = BrowserWindow.getAllWindows()[0] ?? null
      const options: Electron.OpenDialogOptions = {
        title,
        properties: ['openDirectory', 'createDirectory'],
      }
      const trimmed = defaultPath.trim()
      if (trimmed !== '') {
        options.defaultPath = trimmed
      }
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
    },
  )
}
