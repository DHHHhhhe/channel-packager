import { useEffect, useRef } from 'react'
import { Terminal } from 'lucide-react'

interface ProgressPanelProps {
  /** 当前阶段文案；null 表示还没开始 */
  stage: string | null
  /** walle / apksigner 的原始输出行 */
  lines: readonly string[]
  /** 队列模式下的「第几项 / 共几项」；不在队列里时传 null */
  queueProgress?: { index: number; total: number } | null
}

/**
 * 出包过程的可视区。
 * 阶段 5 接入 `task:progress` 后由主进程推事件填充，这里只负责显示，
 * 所以刻意不预设事件结构，只吃「阶段文案 + 原始输出行」。
 */
export function ProgressPanel({ stage, lines, queueProgress = null }: ProgressPanelProps) {
  const idle = stage === null && lines.length === 0
  const boxRef = useRef<HTMLDivElement>(null)

  /*
   * 输出刷得比人读得快，新行进来就贴到底。
   * 不这么做的话，跑完之后看到的永远是最开始那几行 —— 恰恰是已经没用的那几行。
   */
  useEffect(() => {
    const box = boxRef.current
    if (box !== null) {
      box.scrollTop = box.scrollHeight
    }
  }, [lines])

  return (
    <div className="flex flex-col gap-2 rounded-lg border">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
        <Terminal className="size-4 shrink-0" />
        <span className="font-medium">进度</span>
        {/* 读屏用户切页回来也能听到「跑到哪一步了」 */}
        <span className="text-muted-foreground" role="status" aria-live="polite">
          {queueProgress ? `第 ${queueProgress.index}/${queueProgress.total} 项 · ` : ''}
          {stage ?? '尚未开始'}
        </span>
      </div>
      <div ref={boxRef} className="max-h-64 min-h-24 overflow-y-auto px-3 pb-3">
        {idle ? (
          <p className="text-sm text-muted-foreground">
            开始出包后，这里会显示当前阶段与每一步的原始输出。
          </p>
        ) : (
          <pre className="font-mono text-xs whitespace-pre-wrap">{lines.join('\n')}</pre>
        )}
      </div>
    </div>
  )
}
