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
