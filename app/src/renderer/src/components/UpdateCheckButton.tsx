import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { UpdateState } from '@shared/types/update'

/**
 * 侧边栏底部的「检查更新」。
 *
 * 摆在底部版本号旁边：查更新和看版本本来就是一件事，用户想知道「有没有新版本」时
 * 眼睛就在这一块，不必再去菜单里找。帮助菜单里也有一项（main/menu.ts），两边走
 * 同一条主进程通道。
 *
 * 只在有自动更新的形态上出现（canUpdate 由主进程给，见 shared/types/update.ts）：
 * 不是安装版的点它只会得到一句「没有自动更新」，而菜单里那一项在同样条件下
 * 也是隐藏的，这里保持一致。
 *
 * 按钮的文案与动作跟着主进程推来的阶段走，本地不记第二份：从菜单点的那次检查，
 * 这个按钮也该显示成「检查中」。两种「什么都没发生」的结果（已是最新 / 检查失败）
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

  const { phase, percent } = state
  const checking = phase === 'checking'
  const downloading = phase === 'downloading'

  /*
   * 只有「正在检查」和「正在下载」时按钮不可点。
   *
   * available（发现新版本、等用户决定下不下）必须保持可点：用户点过提示条的「稍后」
   * 之后提示条就收了，这里是唯一的入口。早先把 available 也算作「忙」，结果点完
   * 「稍后」按钮一直是灰的，更新彻底没法继续。
   */
  const blocked = checking || downloading

  const label = checking
    ? '检查中…'
    : downloading
      ? `下载中 ${percent}%`
      : phase === 'available'
        ? '下载更新'
        : phase === 'downloaded'
          ? '重启并更新'
          : '检查更新'

  const hint = checking
    ? '正在检查更新'
    : downloading
      ? '新版本正在下载'
      : phase === 'available'
        ? '发现新版本，点击开始下载'
        : phase === 'downloaded'
          ? '新版本已下载，点击完成安装'
          : '检查更新'

  const act = async (): Promise<void> => {
    try {
      if (phase === 'available') {
        await window.api.downloadUpdate()
        return
      }
      if (phase === 'downloaded') {
        // 重启前要核对未保存的改动与正在跑的任务，那段逻辑在提示条里；
        // 这里把它叫回来，而不是自己再走一遍
        window.dispatchEvent(new CustomEvent('update:reveal'))
        return
      }
      await window.api.checkUpdate()
    } catch (error) {
      // 主进程那条路不抛异常（失败也是返回一个 error 状态），能走到这儿说明通道本身坏了，
      // 而这件事界面上没有别的地方会说
      console.error('[update] 更新操作失败', error)
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={blocked}
      onClick={() => void act()}
      title={hint}
      aria-live="polite"
      className="text-muted-foreground tabular-nums hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      {checking ? <Spinner className="size-3" /> : <RefreshCw className="size-3" />}
      {label}
    </Button>
  )
}
