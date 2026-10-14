import { useCallback, useEffect, useState } from 'react'
import { Switch } from '@/components/ui/switch'

/**
 * 「启动时自动检查更新」开关。
 *
 * 状态自带，不放进全局 store：它只在侧边栏底部这一处出现，而且是主进程说了算的
 * 一份落盘偏好，提上去反而多一层需要同步的副本。
 *
 * 首次读盘之前开关是禁用的（enabled 为 null）—— 比起先渲染成「关」再跳成「开」，
 * 短暂禁用一下不会骗人。
 */
export function AutoCheckUpdateToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    window.api
      .getAutoCheckUpdate()
      .then((value) => {
        if (alive) {
          setEnabled(value)
        }
      })
      .catch(() => {
        // 读不出来就保持禁用，别让用户以为现在是「关」的状态
        if (alive) {
          setEnabled(null)
        }
      })
    return () => {
      alive = false
    }
  }, [])

  const apply = useCallback(
    async (next: boolean): Promise<void> => {
      /*
       * 先动界面再落盘。写的是本地设置文件，几乎不会失败，等 IPC 回来才动开关
       * 会有一下明显的迟滞。写失败就退回原值，不让界面显示一个跟文件不一样的状态。
       */
      const previous = enabled
      setEnabled(next)
      try {
        const saved = await window.api.setAutoCheckUpdate(next)
        setEnabled(saved)
      } catch {
        setEnabled(previous)
      }
    },
    [enabled],
  )

  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className="text-xs text-muted-foreground"
        title="关掉后只有手动点「检查更新」才会查；已经下好的更新仍会照常安装"
      >
        自动检查更新
      </span>
      <Switch
        aria-label="启动时自动检查更新"
        checked={enabled ?? false}
        disabled={enabled === null}
        onCheckedChange={(next) => {
          void apply(next)
        }}
      />
    </div>
  )
}
