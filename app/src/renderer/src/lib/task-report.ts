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
