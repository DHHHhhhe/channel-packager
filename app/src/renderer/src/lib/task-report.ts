import type { TaskResult, TaskStage } from '@shared/types/task'

/**
 * 阶段的中文名。进度面板、失败诊断、复制出去的文本都用这一份，别各写各的。
 *
 * 一律写成「动词 + 宾语」的中文，不带命令行工具名（zipalign / apksigner / walle）——
 * 界面是给用工具的人看的，不是给读日志的人看的。
 */
export const STAGE_LABELS: Record<TaskStage, string> = {
  validate: '检查输入',
  prepare: '准备工作目录',
  'check-source': '检查输入包签名',
  align: '对齐安装包',
  sign: '重新签名',
  'verify-sign': '验证签名',
  rename: '还原原始文件名',
  'resigned-copy': '另存未写渠道的签名包',
  'channel-json': '生成渠道配置',
  walle: '注入渠道信息',
  check: '验证产物渠道号',
  'check-sign': '验证产物签名证书',
  publish: '移动到输出目录',
  done: '完成',
  cancelled: '已取消',
  failed: '失败',
}

/**
 * 拼出「复制诊断信息」的内容。
 *
 * 只放定位问题用得上的东西，不塞组件版本 —— 收件人真正要看的是卡在哪一步、
 * 退出码多少、那一步说了什么。家目录的脱敏不在这里做：主进程写剪贴板时按
 * `os.homedir()` 精确替换（见 app/src/main/ipc/clipboard.ts），
 * 比在这儿拿正则猜路径长什么样可靠（用户名带空格时会猜错）。
 */
export function buildDiagnostic(result: TaskResult): string {
  const failure = result.failure
  const lines: string[] = [
    '渠道分包工具 · 出包失败',
    `任务号：${result.taskId}`,
    `失败步骤：${failure ? STAGE_LABELS[failure.stage] : '未知'}`,
    `原因：${result.message}`,
  ]
  if (failure?.exitCode !== undefined) {
    lines.push(`退出码：${failure.exitCode}`)
  }
  if (failure?.timedOut) {
    lines.push('该步骤一直没有输出，等满超时时间后被强制结束')
  }
  if (failure && failure.outputTail && failure.outputTail.length > 0) {
    lines.push(`该步骤输出末尾 ${failure.outputTail.length} 行：`)
    for (const line of failure.outputTail) {
      lines.push(`    ${line}`)
    }
  }
  if (result.outputDir !== '') {
    lines.push(`输出目录：${result.outputDir}`)
  }
  if (result.workDir !== '') {
    lines.push(`工作目录：${result.workDir}`)
  }
  lines.push(`日志：${result.logFile}`)
  if (result.warnings.length > 0) {
    lines.push('过程中的提醒：')
    for (const warning of result.warnings) {
      lines.push(`    ${warning}`)
    }
  }
  // 记事本也能正常换行，别只给 \n
  return lines.join('\r\n')
}

/**
 * 失败后能按的那一个键。
 *
 * 报告里只写「卡在验证签名」这种事实，人知道发生了什么，却不知道该点哪里 ——
 * 于是最常见的那几类失败各配一句话 + 一个动作。
 */
export type FixAction = 'jks' | 'output-dir' | 'apk'

export interface FixSuggestion {
  /** 给用户看的一句结论 */
  text: string
  /** 能直接落到界面上的动作；纯文字建议时不传 */
  action?: FixAction
  actionLabel?: string
}

/**
 * 按失败在哪一步给一句「接下来怎么办」。
 *
 * 只认那几个高频且动作明确的：说不清原因时宁可不给 —— 给一句不痛不痒的
 * 「请检查配置」比不给更糟，人点了没变化只会更迷惑。
 */
export function suggestFix(result: TaskResult): FixSuggestion | null {
  const failure = result.failure
  if (!failure) {
    return null
  }
  switch (failure.stage) {
    case 'check-source':
    case 'verify-sign':
    case 'check-sign':
      return {
        text: '原包的签名和当前选的签名文件对不上。换成给这个包签名的那份签名文件；手上没有私钥的话，把签名模式改成「跳过签名」只写渠道。',
        action: 'jks',
        actionLabel: '去换签名文件',
      }
    case 'publish':
      return {
        text: '产物没能移到输出目录。常见原因是该目录正被其他程序占用（资源管理器打开着，或其中的表格正被 Excel 打开），也可能没有写权限。换一个目录再试。',
        action: 'output-dir',
        actionLabel: '换个输出目录',
      }
    case 'validate':
      return {
        text: '这个原包读不出来。确认它还在原来的位置、没有被移走或改名，然后重新选一次。',
        action: 'apk',
        actionLabel: '重新选择 APK',
      }
    case 'walle':
      return {
        text: '往包里写渠道信息这一步会失败。加固过的包、以及已经被别的工具写过渠道的包都会如此 —— 换一个没有写过渠道的原始包再试。',
      }
    default:
      return null
  }
}

/**
 * 产物清单的纯文本，给「复制产物清单」用。
 *
 * 出完几十个包要挨个发给不同的人时，一份能直接粘进聊天窗口的清单比在
 * 资源管理器里翻找省事得多。用制表符分隔，粘进表格软件就是一列一列的。
 */
export function buildArtifactList(result: TaskResult): string {
  if (result.artifacts.length === 0) {
    return ''
  }
  const lines = ['文件名\t渠道号\t别名\t校验\t完整路径']
  for (const artifact of result.artifacts) {
    const verified = artifact.verified ? '通过' : (artifact.note ?? '未通过')
    lines.push(
      [artifact.fileName, artifact.channel || '(空)', artifact.alias ?? '', verified, artifact.path].join(
        '\t',
      ),
    )
  }
  return lines.join('\r\n')
}
