import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import { IPC_CHANNELS } from '../../shared/constants/channels'

/**
 * 用系统默认方式打开一个目录或文件（结果卡片上的「打开输出目录」「打开日志」）。
 *
 * 返回错误信息而不是抛异常：`shell.openPath` 本身就是这个契约（成功时空串），
 * 调用方多半只想把话说给用户听，不需要区分「路径不存在」还是「没有关联程序」。
 *
 * 路径先自己验一遍再交出去：失败时工作目录、日志文件都可能被手工删掉或挪走，
 * 交给系统打开只会弹一句更难懂的系统错误。
 */
export function registerShellIpc(): void {
  ipcMain.handle(IPC_CHANNELS.shellOpenPath, async (_event, targetPath: string) => {
    const target = targetPath.trim()
    if (target === '') {
      return '没有可打开的路径'
    }
    if (!fs.existsSync(target)) {
      return '路径不存在，可能已经被移走或删掉了'
    }
    return shell.openPath(target)
  })
}
