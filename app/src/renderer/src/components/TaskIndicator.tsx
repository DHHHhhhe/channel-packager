import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useNav } from '@/store/nav'
import { useTask } from '@/store/task'

/**
 * 顶栏右侧的「出包中」指示。
 *
 * 出包要跑几十秒到几分钟，人不会一直盯着进度条。切到别的页面去改配置是常事，
 * 所以得在顶栏一直看得见「还在跑 / 跑到哪一步了」，并且随时能取消 —— 而不是
 * 切回来才发现像是没跑过、再点一次还被「已有任务在进行」顶回来。
 *
 * role="status" + aria-live：读屏用户也能在切页时听到状态变化。
 */
export function TaskIndicator() {
  const { running, stage, cancel } = useTask()
  const { view, go } = useNav()
  const [cancelling, setCancelling] = useState(false)

  if (!running) {
    return null
  }

  async function handleCancel(): Promise<void> {
    setCancelling(true)
    const cancelled = await cancel()
    setCancelling(false)
    if (!cancelled) {
      // 任务刚好在这一瞬间跑完了，别骗人说「已取消」
      toast.info('这一步没能取消：任务已经结束了')
    }
  }

  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        出包中 · {stage ?? '准备中'}
      </span>
      {/* 已经在出包页时不必再给一个「查看」 */}
      {view === 'pack' ? null : (
        <Button type="button" variant="outline" size="xs" onClick={() => go('pack')}>
          查看
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={cancelling}
        onClick={() => void handleCancel()}
      >
        {cancelling ? '正在取消…' : '取消出包'}
      </Button>
    </div>
  )
}
