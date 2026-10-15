import fs from 'node:fs'
import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/channels'
import type { ApkManifest } from '../../shared/types/apk'
import type {
  SignMode,
  SourceCheckResult,
  TaskInput,
  TaskProgressEvent,
  TaskRunningState,
  TaskStage,
  TaskStartResult,
  WalleShowResult,
} from '../../shared/types/task'
import { readApkManifest } from '../apk-manifest'
import { newTaskId, runPipeline } from '../pipeline'
import { resolveInData } from '../paths'
import { probeKeystoreCertificate, readApkSignature } from '../signer'
import { readJksFile } from '../store'
import { walleShowChannel } from '../walle'

/**
 * 同时只允许一个出包任务。
 * 界面只有一个进度区（K8：一次一个 APK + 一个 jks），并发跑会让进度互相覆盖，
 * 与其显示错乱不如明确拒绝。
 */
let runningTaskId: string | null = null

/**
 * 取消正在跑的任务。任务结束时置空 —— 留着的话，下一次点取消会对着
 * 一个早就跑完的任务调 abort，看起来像「取消成功了」其实什么也没发生。
 */
let runningAbort: AbortController | null = null

/**
 * 当前阶段与说明。只给 `task:getRunning` 用：界面切页回来或刷新窗口后
 * 拿它把状态接上，不至于以为没跑过。
 */
let runningStage: TaskStage = 'validate'
let runningMessage = ''

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
      const abort = new AbortController()
      runningTaskId = taskId
      runningAbort = abort
      runningStage = 'validate'
      runningMessage = '启动中'

      /*
       * 按契约立刻返回 taskId，不 await：出包要跑几十秒，invoke 挂在那里
       * 既拿不到进度也无法取消。阶段与实时输出都走 task:progress，终态也在其中。
       */
      void runPipeline(taskId, input, {
        signal: abort.signal,
        onProgress: (stage, message, line) => {
          runningStage = stage
          if (message !== '') {
            runningMessage = message
          }
          broadcast({ taskId, stage, message, line })
        },
      })
        .then((result) => {
          broadcast({
            taskId,
            stage: result.ok ? 'done' : result.failure?.cancelled === true ? 'cancelled' : 'failed',
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
          runningAbort = null
        })

      return { taskId }
    },
  )

  /*
   * 取消：只 abort 信号，不等结果。
   * 流水线自己会走完收尾（杀子进程、把终态广播出来），这里再去 await 一次
   * 只会让界面白等 —— 它要的是「点了就有反应」。
   */
  ipcMain.handle(IPC_CHANNELS.taskCancel, (): boolean => {
    if (runningAbort === null) {
      return false
    }
    runningAbort.abort()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.taskGetRunning, (): TaskRunningState | null => {
    if (runningTaskId === null) {
      return null
    }
    return { taskId: runningTaskId, stage: runningStage, message: runningMessage }
  })

  ipcMain.handle(
    IPC_CHANNELS.walleShow,
    async (_event, apkPath: string): Promise<WalleShowResult> => {
      const channel = await walleShowChannel(apkPath)
      return {
        ok: channel.ok,
        message: channel.ok ? '' : channel.raw || '没能读出渠道信息',
        channel: channel.channel,
      }
    },
  )

  /*
   * 只读：出包表单上「这个包能不能这么出」的提前判断。
   * 真正的权威校验在流水线里（那里失败会中止出包），这里只是让人在点按钮
   * 之前就看见 —— 尤其是包是别人签的、手上没有对应私钥的时候。
   */
  ipcMain.handle(
    IPC_CHANNELS.taskCheckSource,
    async (_event, apkPath: string, jksId: string, signMode: SignMode): Promise<SourceCheckResult> => {
      return describeSource(apkPath, jksId, signMode)
    },
  )

  /*
   * 只读：读 APK 清单里的包名、版本与应用名。
   *
   * 纯本地解析（ZIP + 二进制 XML），不需要 Java 或 Android SDK —— 与整个工具的
   * 「装上就能用」是一回事。读不出来时返回全空字段而不是抛错：调用方多半只是
   * 想顺手多拿一点信息去匹配，为此把导入流程弄失败不划算。
   */
  ipcMain.handle(IPC_CHANNELS.apkReadManifest, (_event, apkPath: string): ApkManifest => {
    return readApkManifest(apkPath)
  })
}

function shortDigest(digest: string): string {
  return `${digest.slice(0, 16)}…`
}

async function describeSource(
  apkPath: string,
  jksId: string,
  signMode: SignMode,
): Promise<SourceCheckResult> {
  const target = apkPath.trim()
  if (target === '') {
    return { ok: false, apkDigest: '', message: '还没有选 APK。' }
  }
  if (!fs.existsSync(target)) {
    return { ok: false, apkDigest: '', message: '这个路径下没有文件。' }
  }

  const apk = await readApkSignature(target)
  const base: SourceCheckResult = { ok: true, apkDigest: apk.digest, v2: apk.v2, message: '' }

  /*
   * 重签名这条路不受输入包原签名影响：zipalign + apksigner 会重新签一份，
   * 所以 v1-only 也好、没签名也好，都能走下去 —— 这里只做说明，不拦。
   */
  if (signMode === 'sign') {
    return {
      ...base,
      message:
        apk.digest === ''
          ? '这个包没有可读的签名证书；因为会重新签名，不影响出包。'
          : `这个包由证书 ${shortDigest(apk.digest)} 签署；因为会重新签名，它原本的证书不影响结果。`,
    }
  }

  if (apk.digest === '') {
    return { ...base, ok: false, message: '这个包读不出签名证书（没签名或文件损坏），跳过签名会得到装不上的包。' }
  }
  if (apk.v2 === false) {
    return {
      ...base,
      ok: false,
      message:
        '这个包只有 v1 签名。渠道要写进 APK Signing Block，只认 v2 —— ' +
        '得先重新签名一次，或者改用「重签名」模式。',
    }
  }

  const id = jksId.trim()
  if (id === '') {
    return {
      ...base,
      message: `这个包由证书 ${shortDigest(apk.digest)} 签署；没有选签名文件，所以只写渠道、不重签名。`,
    }
  }

  const item = readJksFile().items.find((entry) => entry.id === id)
  if (!item) {
    return { ...base, message: `找不到签名文件「${id}」。` }
  }
  if (item.alias.trim() === '' || item.storePassword === '') {
    return { ...base, message: `签名文件「${id}」还缺别名或密码，先到「签名配置」补上。` }
  }
  const keystorePath = resolveInData(item.keystoreFile)
  if (!fs.existsSync(keystorePath)) {
    return { ...base, message: `签名文件「${id}」的副本不存在，先到「签名配置」重新导入。` }
  }

  let keystoreDigest = ''
  try {
    const keystore = await probeKeystoreCertificate(keystorePath, item.alias, item.storePassword)
    keystoreDigest = keystore.digest
  } catch {
    return { ...base, message: `读签名文件「${id}」里的证书失败，多半是密码不对 —— 先到「签名配置」校验一下。` }
  }

  const head = `这个包由证书 ${shortDigest(apk.digest)} 签署`
  if (keystoreDigest === apk.digest) {
    return { ...base, jksDigest: keystoreDigest, message: `${head}，与签名文件「${id}」一致。` }
  }
  return {
    ...base,
    jksDigest: keystoreDigest,
    ok: false,
    message:
      `${head}，和签名文件「${id}」的证书 ${shortDigest(keystoreDigest)} 不一样。` +
      '跳过签名会把签名对不上的包发出去，已被拦下 —— 要么换用对得上的包，要么改用「重签名」。',
  }
}
