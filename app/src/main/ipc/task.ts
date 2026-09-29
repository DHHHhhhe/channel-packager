import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/channels'
import type { TaskInput, TaskProgressEvent, TaskStartResult, WalleShowResult } from '../../shared/types/task'
import { newTaskId, runPipeline } from '../pipeline'
import { walleShowChannel, walleShowExtraInfo } from '../walle'

/**
 * 同时只允许一个出包任务。
 * 界面只有一个进度区（K8：一次一个 APK + 一个 jks），并发跑会让进度互相覆盖，
 * 与其显示错乱不如明确拒绝。
 */
let runningTaskId: string | null = null

function broadcast(payload: TaskProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.taskProgress, payload)
    }
  }
}

export function registerTaskIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.taskRun,
    (_event, input: TaskInput): TaskStartResult => {
      if (runningTaskId !== null) {
        throw new Error(`已有出包任务在进行（${runningTaskId}），请等它结束再试`)
      }
      const taskId = newTaskId()
      runningTaskId = taskId

      /*
       * 按契约立刻返回 taskId，不 await：出包要跑几十秒，invoke 挂在那里
       * 既拿不到进度也无法取消。阶段与实时输出都走 task:progress，终态也在其中。
       */
      void runPipeline(taskId, input, {
        onProgress: (stage, message, line) => broadcast({ taskId, stage, message, line }),
      })
        .then((result) => {
          broadcast({
            taskId,
            stage: result.ok ? 'done' : 'failed',
            message: result.message,
            result,
          })
        })
        .catch((error: unknown) => {
          broadcast({
            taskId,
            stage: 'failed',
            message: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(() => {
          runningTaskId = null
        })

      return { taskId }
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.walleShow,
    async (_event, apkPath: string): Promise<WalleShowResult> => {
      const channel = await walleShowChannel(apkPath)
      const extra = await walleShowExtraInfo(apkPath)
      return {
        ok: channel.ok,
        message: channel.ok ? '' : channel.raw || 'walle 没能读出渠道信息',
        channel: channel.channel,
        extraInfo: extra.ok ? extra.raw : undefined,
      }
    },
  )
}
