import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Download, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { useNav } from '@/store/nav'
import type { UpdateState } from '@shared/types/update'

/**
 * 自动更新的提示条。
 *
 * 只有安装版才会真的出现（便携版与解压即用版没有安装目录，见主进程 updater.ts）。
 * 三种状态各有去处：下载中给进度，下载好了给「立即重启」，其余一律不占位置 ——
 * 「已经是最新」与「检查失败」只会在用户自己点过「检查更新」之后用一句提示收尾，
 * 免得每次启动都冒出「已是最新」这种没人问的话。
 */
export default function UpdateBanner(): JSX.Element | null {
  const { hasUnsaved, allowUnload } = useNav()
  const [state, setState] = useState<UpdateState | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

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

  const downloading = state.phase === 'available' || state.phase === 'downloading'
  const ready = state.phase === 'downloaded'
  if (!downloading && !ready) {
    return null
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
      toast.warning('正在出包，等这一单跑完再更新。')
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
          ) : (
            <span className="text-xs text-muted-foreground">
              也可以先接着用，下次关窗口时会自己装上。
            </span>
          )}
        </div>
      </div>

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
        warning="页面上还有没保存的修改，重启后会丢掉。"
        confirmText="仍然重启"
        onConfirm={() => {
          setConfirmOpen(false)
          restart()
        }}
      />
    </div>
  )
}
