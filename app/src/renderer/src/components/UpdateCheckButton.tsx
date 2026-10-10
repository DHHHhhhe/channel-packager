import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { UpdatePhase, UpdateState } from '@shared/types/update'

/** 这几个阶段点「检查更新」是白点：正在检查，或者新版本已经在下载 / 等着装 */
const BUSY_PHASES = new Set<UpdatePhase>(['checking', 'available', 'downloading', 'downloaded'])

/**
 * 侧边栏底部的「检查更新」。
 *
 * 摆在底部版本号上方、与数据目录的两个动作同行：查更新和看版本本来就是一件事，
 * 用户想知道「有没有新版本」时眼睛就在这一块，不必再去菜单里找。
 *
 * 帮助菜单里也有一项（main/menu.ts），两边走同一条主进程通道。
 *
 * 只在有自动更新的形态上出现（canUpdate 由主进程给，见 shared/types/update.ts）：
 * 便携版与解压即用版点它只会得到一句「没有自动更新」，而菜单里那一项在同样条件下
 * 也是隐藏的，这里保持一致。
 *
 * 显示什么、能不能点，全部跟着主进程推来的状态走，本地不记第二份：从菜单点的那次
 * 检查，这个按钮也该显示成「检查中」。两种「什么都没发生」的结果（已是最新 / 检查失败）
 * 不在这里提示 —— UpdateBanner 已经在按 state.manual 收尾，这里再说一遍就是同一件事弹两次。
 */
export default function UpdateCheckButton() {
  const [state, setState] = useState<UpdateState | null>(null)

  useEffect(() => {
    let cancelled = false

    void window.api.getUpdateState().then((next) => {
      if (!cancelled) {
        setState(next)
      }
    })

    const unsubscribe = window.api.onUpdateState((next) => {
      setState(next)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  // 状态还没接上时先不出现，免得侧边栏底部闪一下
  if (!state?.canUpdate) {
    return null
  }

  const checking = state.phase === 'checking'
  const blocked = BUSY_PHASES.has(state.phase)

  const check = async (): Promise<void> => {
    try {
      await window.api.checkUpdate()
    } catch (error) {
      // 主进程那条路不抛异常（失败也是返回一个 error 状态），能走到这儿说明通道本身坏了，
      // 而这件事界面上没有别的地方会说
      console.error('[update] 检查更新失败', error)
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={blocked}
      onClick={() => void check()}
      title={checking ? '正在检查更新' : blocked ? '新版本正在下载，下好会自动装上' : '检查更新'}
      aria-live="polite"
      className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      {checking ? <Spinner className="size-3" /> : <RefreshCw className="size-3" />}
      {checking ? '检查中…' : '检查更新'}
    </Button>
  )
}
