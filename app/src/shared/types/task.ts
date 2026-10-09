/** 出包任务的输入与结果契约。主进程与渲染层共用，改动需两边同步。 */

import type { ChannelEntry } from './store'

export type SignMode = 'sign' | 'skip'

/**
 * 出包输入。签名与渠道来源是两件正交的事：
 *
 * - `jksId` 只管签名：给了就用它重签名（`signMode = 'sign'`），不给就只能跳过签名。
 *   它不再决定渠道从哪来 —— 渠道的归属是「分组」。
 * - 渠道来源二选一：`groupId`（「渠道配置」里的分组）或 `channelInfoList`
 *   （出包页「自定义渠道导出」临时给的那份列表）。
 *
 * 条目直接带过来而不是给一个文件路径：使用者可能在预览框里改过内容，
 * 再从磁盘读一遍等于把改动丢掉。
 */
export interface TaskInput {
  apkPath: string
  jksId?: string
  /** 渠道来源 A：分组 id，渠道条目取这个分组 */
  groupId?: string
  /** 渠道来源 B：临时带过来的渠道条目；与 groupId 二选一 */
  channelInfoList?: ChannelEntry[]
  channelCodes: string[]
  signMode: SignMode
  outputDir: string
}

/** 与 design.md 流水线步骤一一对应，界面按它显示当前阶段 */
export type TaskStage =
  | 'validate'
  | 'prepare'
  | 'check-source'
  | 'align'
  | 'sign'
  | 'verify-sign'
  | 'rename'
  | 'resigned-copy'
  | 'channel-json'
  | 'walle'
  | 'check'
  /** 跳过签名时核对产物的签名证书是否还是输入包那一个 */
  | 'check-sign'
  | 'publish'
  | 'done'
  /** 用户主动取消。与 failed 分开，界面才能说「已取消」而不是「失败」 */
  | 'cancelled'
  | 'failed'

export interface TaskProgressEvent {
  taskId: string
  stage: TaskStage
  /** 阶段说明，给人看的一句话 */
  message: string
  /** 子进程的原始输出行，逐行推送 */
  line?: string
  /** 终态（done / failed）时带完整结果 */
  result?: TaskResult
}

export interface TaskArtifact {
  channel: string
  alias?: string
  fileName: string
  path: string
  /** 用 walle show 读回的渠道号 */
  actualChannel?: string
  /** 读回的渠道号与预期一致 */
  verified: boolean
  note?: string
}

/**
 * 失败诊断：让人不必去翻日志就能看出卡在哪一步。
 *
 * `stage` 是失败前最后进入的阶段（不是 `'failed'` 本身）；`exitCode` 与
 * `outputTail` 只有子进程失败时才有 —— 我们自己的输入校验失败既没有退出码，
 * 也没有子进程输出，那两个字段就是空的。
 */
export interface TaskFailure {
  stage: TaskStage
  /** 子进程退出码；自查失败（例如「尚未勾选任何渠道」）时为 undefined */
  exitCode?: number
  /** 失败步骤子进程输出的末尾若干行，竖排展示 */
  outputTail?: string[]
  /** 进程是被超时强制结束的（不是自己跑完退出） */
  timedOut?: boolean
  /**
   * 用户点了「取消」。此时 `stage` 是取消时所在的阶段，其余字段都为空 ——
   * 界面要说「已取消」，不要摆出一份像是出错的结果。
   */
  cancelled?: boolean
}

export interface TaskResult {
  taskId: string
  ok: boolean
  message: string
  outputDir: string
  workDir: string
  logFile: string
  artifacts: TaskArtifact[]
  /** 不中止流程但需要让人知道的问题 */
  warnings: string[]
  /** 只有 ok === false 时存在 */
  failure?: TaskFailure
}

export interface TaskStartResult {
  taskId: string
}

/**
 * 「现在有没有出包任务在跑」。
 *
 * 窗口刷新、或从别的页面切回来时用它把状态接上：主进程一直在跑，
 * 界面不该以为没跑过 —— 否则再点一次会被「已有任务在进行」拒掉，
 * 而人根本看不到是哪一个在跑。
 */
export interface TaskRunningState {
  taskId: string
  stage: TaskStage
  /** 阶段说明，给人看的一句话 */
  message: string
}

export interface WalleShowResult {
  ok: boolean
  message: string
  /** walle show -c 读回的渠道号 */
  channel?: string
}

/**
 * 「这个输入包能不能按当前设置出包」的提前判断。
 *
 * 出包流水线自己也会查一遍（那是权威的），这里是为了让人在点「开始出包」
 * 之前就看见 —— 尤其是包是别人签的、手上没有对应私钥的时候。
 */
export interface SourceCheckResult {
  /** 按当前签名模式，这个输入包能不能继续 */
  ok: boolean
  /** 输入包的签名证书 SHA-256（小写十六进制）；空串表示读不出 */
  apkDigest: string
  /** 输入包有没有 v2 签名 —— walle 写渠道的硬要求；认不出时为 undefined */
  v2?: boolean
  /** 选了 jks 时它的证书 SHA-256；读不出就没有这个字段 */
  jksDigest?: string
  /** 给人看的一句话 */
  message: string
}
