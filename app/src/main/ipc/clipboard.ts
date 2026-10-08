import { clipboard, ipcMain } from 'electron'
import os from 'node:os'
import { IPC_CHANNELS } from '../../shared/constants/channels'

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 复制出去的文本里不该带本机用户名。
 *
 * 用 `os.homedir()` 精确匹配，而不是拿正则去猜路径长什么样：用户名里带空格
 * （`C:\Users\John Doe`）时按「非空白字符」切会漏掉后半截。分隔符统一成
 * 「反斜杠或正斜杠」，大小写不敏感 —— 子进程偶尔会打印 `c:/users/...`。
 *
 * 只动家目录这一段：`C:\Users\alice\Desktop\发布包` 变成
 * `%USERPROFILE%\Desktop\发布包`，后面的层级原样保留，收件人照着改就能对上。
 */
export function maskUserProfile(text: string): string {
  const home = os.homedir()
  if (home === '') {
    return text
  }
  const parts = home
    .split(/[\\/]+/)
    .filter((part) => part !== '')
    .map(escapeRegExp)
  if (parts.length === 0) {
    return text
  }
  return text.replace(new RegExp(parts.join('[\\\\/]'), 'gi'), '%USERPROFILE%')
}

export function registerClipboardIpc(): void {
  ipcMain.handle(IPC_CHANNELS.clipboardWrite, (_event, text: string) => {
    clipboard.writeText(maskUserProfile(text))
  })
}
