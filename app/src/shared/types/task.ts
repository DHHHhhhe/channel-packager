/** 出包任务的输入与结果契约。主进程与渲染层共用，改动需两边同步。 */

export type SignMode = 'sign' | 'skip'

export interface TaskInput {
  apkPath: string
  jksId: string
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
  | 'publish'
  | 'done'
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

export interface WalleShowResult {
  ok: boolean
  message: string
  /** walle show -c 读回的渠道号 */
  channel?: string
  /** walle show -e 读回的额外信息原始输出 */
  extraInfo?: string
}
