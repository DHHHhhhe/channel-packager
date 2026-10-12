import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Download, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { useNav } from '@/store/nav'
import type { UpdateState } from '@shared/types/update'

/**
 * 把更新内容压成一段纯文本。
 *
 * 两条更新源给的格式不一样：GitHub 那条路给的是 HTML（atom feed 的 content），
 * 内网 generic 源（数据目录里的 update.json）给的是 latest.yml 里原样的 markdown。
 * 所以先按 HTML 解一次，再把 markdown 的记号收拾掉 —— 不然界面上会直接冒出
 * 「### 」这种字符。
 *
 * 用 DOMParser 而不是往临时元素里塞 innerHTML：解析出来的是游离文档，图片与事件
 * 属性都没有机会执行。
 */
function notesToText(raw: string): string {
  if (!raw) {
    return ''
  }
  let text = raw
  try {
    text = new DOMParser().parseFromString(raw, 'text/html').body.textContent ?? raw
  } catch {
    text = raw
  }
  return text
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 自动更新的提示条。
 *
 * 只有安装版才会真的出现（便携版与解压即用版没有安装目录，见主进程 updater.ts）。
 * 三个阶段各有去处：
 *   available   —— 发现新版本，把「更新了什么」摆出来，下不下由用户点
 *   downloading —— 进度条
 *   downloaded  —— 「立即重启并更新」
 * 其余一律不占位置：「已经是最新」与「检查失败」只会在用户自己点过「检查更新」
 * 之后用一句提示收尾，免得每次启动都冒出「已是最新」这种没人问的话。
 */
export default function UpdateBanner(): JSX.Element | null {
  const { hasUnsaved, allowUnload } = useNav()
  const [state, setState] = useState<UpdateState | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    let cancelled = false

    void window.api.getUpdateState().then((next) => {
      if (!cancelled) {
        setState(next)
      }
    })

    const unsubscribe = window.api.onUpdateState((next) => {
      setState(next)
      // 又来一个新版本就重新露头：上一次的「稍后」不该把这一条也压住
      if (next.phase === 'available') {
        setDismissed(false)
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  // 手动检查的两种「什么都没发生」的结果，界面上没有常驻位置，用一句提示收尾
  useEffect(() => {
    if (!state?.manual) {
      return
    }
    if (state.phase === 'up-to-date') {
      toast.success('已经是最新版本。', { id: 'update-check' })
    }
    if (state.phase === 'error') {
      toast.error(state.message, { id: 'update-check' })
    }
  }, [state])

  if (!state || dismissed) {
    return null
  }

  const offering = state.phase === 'available'
  const downloading = state.phase === 'downloading'
  const ready = state.phase === 'downloaded'
  if (!offering && !downloading && !ready) {
    return null
  }

  const notes = offering ? notesToText(state.releaseNotes) : ''

  const startDownload = async (): Promise<void> => {
    setStarting(true)
    try {
      await window.api.downloadUpdate()
    } finally {
      // 主进程一开始下载就会把状态推成 downloading，这个按钮随即消失；
      // 万一没推（比如版本已经被撤下），这里把按钮恢复成可点，别卡在「正在开始下载…」
      setStarting(false)
    }
  }

  const restart = (): void => {
    // 放行关窗口：未保存的改动已经在下面确认过了，否则这次退出会被拦下来
    allowUnload()
    void window.api.installUpdate()
  }

  const handleRestart = async (): Promise<void> => {
    // 出包任务跑在子进程里，重启会把这一单掐断
    const running = await window.api.getRunningTask()
    if (running) {
      toast.warning('正在出包，当前任务结束后再更新。')
      return
    }
    if (hasUnsaved()) {
      setConfirmOpen(true)
      return
    }
    restart()
  }

  return (
    <div
      data-slot="update-banner"
      className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
    >
      <div className="flex items-start gap-2">
        {downloading ? (
          <Download className="mt-0.5 size-4 shrink-0 text-primary" />
        ) : (
          <RotateCw className="mt-0.5 size-4 shrink-0 text-primary" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span>{state.message}</span>

          {downloading ? (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={state.percent}
              aria-label="更新下载进度"
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${state.percent}%` }}
              />
            </div>
          ) : null}

          {/* 更新内容：Release 正文写了才有，没写就整块不出现 */}
          {offering && notes ? (
            <div
              data-slot="update-notes"
              className="max-h-40 overflow-y-auto rounded border bg-background/60 px-2 py-1.5 text-xs whitespace-pre-wrap text-muted-foreground"
            >
              {notes}
            </div>
          ) : null}

          {ready ? (
            <span className="text-xs text-muted-foreground">
              也可以先接着用，下次关窗口时会自己装上。
            </span>
          ) : null}
        </div>
      </div>

      {offering ? (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <Button size="sm" disabled={starting} onClick={() => void startDownload()}>
            {starting ? '正在开始下载…' : '下载并更新'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
            稍后
          </Button>
        </div>
      ) : null}

      {ready ? (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <Button size="sm" onClick={() => void handleRestart()}>
            立即重启并更新
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
            稍后
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="重启并更新？"
        description="重启后就会用上刚下载的新版本。"
        warning="页面上还有未保存的修改，重启后会丢失。"
        confirmText="仍然重启"
        onConfirm={() => {
          setConfirmOpen(false)
          restart()
        }}
      />
    </div>
  )
}
