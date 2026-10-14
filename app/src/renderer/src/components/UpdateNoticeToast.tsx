import { useEffect } from 'react'
import { toast } from 'sonner'

/**
 * 「已更新到 x.y.z」的一次性提示。
 *
 * 装更新那几十秒应用是关着的，用户看不到任何界面 —— 没有进度、也没有完成提示。
 * 重新打开之后如果什么都不说，他没法区分「更新成功」和「当时根本没装上」。
 *
 * 主进程在启动时比对过版本：只有版本真的变了才会有东西可取，而且取一次就没了。
 * 所以这里不需要自己去重，也不会每开一个窗口弹一遍。
 */
export default function UpdateNoticeToast(): null {
  useEffect(() => {
    void window.api
      .consumeVersionNotice()
      .then((notice) => {
        if (!notice) {
          return
        }
        toast.success(`已更新到 v${notice.to}`, {
          // from 为空表示只知道更新过、不知道从哪一版来（从旧版升上来的那次）
          description: notice.from ? `上一版是 v${notice.from}` : undefined,
          // 比默认长一些：这条是「刚才发生了什么」的回执，用户可能正看着别处
          duration: 8000,
        })
      })
      .catch((error: unknown) => {
        // 提示本身失败不该影响启动，记一行就够
        console.error('[update] 读取版本变化提示失败', error)
      })
  }, [])

  return null
}
