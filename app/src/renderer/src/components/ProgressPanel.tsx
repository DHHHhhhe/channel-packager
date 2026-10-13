import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FlowEntry } from '@/store/task'

interface ProgressPanelProps {
  /** 当前阶段文案；null 表示还没开始 */
  stage: string | null
  /** 阶段与中文说明的流水 */
  flow: readonly FlowEntry[]
  /** walle / apksigner 的原始输出行，默认折叠 */
  lines: readonly string[]
  /** 队列模式下的「第几项 / 共几项」；不在队列里时传 null */
  queueProgress?: { index: number; total: number } | null
  /** 这一次是不是失败了。失败时自动展开原始输出，省得再点一下 */
  failed?: boolean
}

/** 流水左侧的时间，只到秒 —— 够看出「哪一步慢」了 */
function timeOf(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * 出包过程的可视区。
 *
 * 默认只显示「阶段流水」：阶段名 + 过程中的中文说明，带时间。
 * 子进程的原始英文输出（walle / apksigner 刷的那些）折在「显示详细日志」后面 ——
 * 界面是给用工具的人看的，满屏英文日志既看不懂也分不出正常还是出错，
 * 真出问题时它才是有用的那一份，所以不删，只是不再占着主视野。
 */
export function ProgressPanel({
  stage,
  flow,
  lines,
  queueProgress = null,
  failed = false,
}: ProgressPanelProps) {
  const idle = stage === null && flow.length === 0 && lines.length === 0
  const [showLog, setShowLog] = useState(false)
  const flowRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  /*
   * 输出刷得比人读得快，新行进来就贴到底。
   * 不这么做的话，跑完之后看到的永远是最开始那几行 —— 恰恰是已经没用的那几行。
   */
  useEffect(() => {
    const box = flowRef.current
    if (box !== null) {
      box.scrollTop = box.scrollHeight
    }
  }, [flow])

  useEffect(() => {
    const box = logRef.current
    if (box !== null) {
      box.scrollTop = box.scrollHeight
    }
  }, [lines, showLog])

  /* 跑挂了就把原始输出摊开：这时候那些英文行正是要拿去问人/复制诊断的东西 */
  useEffect(() => {
    if (failed) {
      setShowLog(true)
    }
  }, [failed])

  return (
    /*
     * 整块给一层比卡片深一档的底：进度区是「嵌进卡片里的一个面板」，
     * 之前它和卡片同为白色、只靠一条边框分界，扫一眼分不出哪里是日志。
     * 详细日志再深一档，于是卡片 → 进度区 → 原始输出形成三级层次。
     */
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/60">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm">
        <Terminal className="size-4 shrink-0" />
        <span className="font-medium">进度</span>
        {/* 读屏用户切页回来也能听到「跑到哪一步了」 */}
        <span className="text-muted-foreground" role="status" aria-live="polite">
          {queueProgress ? `第 ${queueProgress.index}/${queueProgress.total} 项 · ` : ''}
          {stage ?? '尚未开始'}
        </span>
        {lines.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setShowLog((previous) => !previous)}
            aria-expanded={showLog}
          >
            {showLog ? <ChevronDown /> : <ChevronRight />}
            {showLog ? '收起详细日志' : '显示详细日志'}
          </Button>
        ) : null}
      </div>

      <div ref={flowRef} className="max-h-64 min-h-24 overflow-y-auto px-3 pb-3">
        {idle ? (
          <p className="text-sm text-muted-foreground">
            开始出包后，这里会显示当前阶段与每一步的结果。
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {flow.map((entry, index) => (
              <div key={`${entry.at}-${index}`} className="flex gap-2 text-sm">
                <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                  {timeOf(entry.at)}
                </span>
                <span className="min-w-0 break-words">{entry.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showLog && lines.length > 0 ? (
        <div ref={logRef} className="max-h-64 overflow-y-auto border-t bg-muted px-3 py-2">
          <pre className="font-mono text-xs whitespace-pre-wrap">{lines.join('\n')}</pre>
        </div>
      ) : null}
    </div>
  )
}
