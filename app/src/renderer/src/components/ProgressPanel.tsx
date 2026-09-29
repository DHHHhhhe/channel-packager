import { Terminal } from 'lucide-react'

interface ProgressPanelProps {
  /** 当前阶段文案；null 表示还没开始 */
  stage: string | null
  /** walle / apksigner 的原始输出行 */
  lines: readonly string[]
}

/**
 * 出包过程的可视区。
 * 阶段 5 接入 `task:progress` 后由主进程推事件填充，这里只负责显示，
 * 所以刻意不预设事件结构，只吃「阶段文案 + 原始输出行」。
 */
export function ProgressPanel({ stage, lines }: ProgressPanelProps) {
  const idle = stage === null && lines.length === 0

  return (
    <div className="flex flex-col gap-2 rounded-lg border">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
        <Terminal className="size-4 shrink-0" />
        <span className="font-medium">进度</span>
        <span className="text-muted-foreground">{stage ?? '尚未开始'}</span>
      </div>
      <div className="max-h-64 min-h-24 overflow-y-auto px-3 pb-3">
        {idle ? (
          <p className="text-sm text-muted-foreground">
            开始出包后，这里会显示当前阶段与 walle / apksigner 的原始输出。
          </p>
        ) : (
          <pre className="font-mono text-xs whitespace-pre-wrap">{lines.join('\n')}</pre>
        )}
      </div>
    </div>
  )
}
