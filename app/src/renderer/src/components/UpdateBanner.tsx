import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Download, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useNav } from '@/store/nav'
import type { UpdateState } from '@shared/types/update'

/**
 * 更新内容的一节：`### 标题` 加它下面的列表项。
 * 标题为空表示这段没有小标题，直接是列表。
 */
interface NoteSection {
  title: string
  items: string[]
}

/**
 * 把更新内容拆成「标题 + 列表项」，而不是压成一坨纯文本。
 *
 * 两条更新源给的格式不一样：GitHub 那条给 HTML（atom feed 的 content），内网 generic 源
 * 给 latest.yml 里原样的 markdown。先统一成文本，再按 `### 标题` 切段、按 `- ` 收列表项 ——
 * 拍平成一段的话，分类标题和正文同字号同颜色，扫读时分不出「哪几类改动」。
 *
 * 认不出结构的行整行当一条，宁可朴素也不要丢内容。
 * 用 DOMParser 而不是往临时元素里塞 innerHTML：解析出来的是游离文档，图片与事件属性
 * 都没有机会执行。
 */
function parseNotes(raw: string): NoteSection[] {
  if (!raw) {
    return []
  }
  let text = raw
  try {
    text = new DOMParser().parseFromString(raw, 'text/html').body.textContent ?? raw
  } catch {
    text = raw
  }

  const stripBold = (line: string): string => line.replace(/\*\*(.+?)\*\*/g, '$1').trim()

  const sections: NoteSection[] = []
  let current: NoteSection = { title: '', items: [] }

  const flush = (): void => {
    if (current.title !== '' || current.items.length > 0) {
      sections.push(current)
    }
    current = { title: '', items: [] }
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') {
      continue
    }
    const heading = /^#{1,6}\s*(.+)$/.exec(line)
    if (heading) {
      flush()
      current.title = stripBold(heading[1])
      continue
    }
    const item = /^[-*]\s+(.+)$/.exec(line)
    if (item) {
      current.items.push(stripBold(item[1]))
      continue
    }
    current.items.push(stripBold(line))
  }
  flush()

  return sections
}

/**
 * 分类标题上色：新增用绿、修复用橙、其余用蓝。
 * 让用户先扫到「这一版有哪几类改动」，再决定要不要看细节。
 */
function NoteSectionTitle({ title }: { title: string }): JSX.Element {
  const variant = /新增|功能|特性/.test(title)
    ? 'success'
    : /修复|修正|问题/.test(title)
      ? 'warning'
      : 'info'
  return (
    <Badge variant={variant} className="self-start">
      {title}
    </Badge>
  )
}

/**
 * GitHub 标记。
 *
 * 不走 lucide：Lucide 从 1.0 起移除了全部品牌图标（见其 brand-logo-statement），
 * 项目装的 1.48.0 里已经没有 Github 了。这里内联 Simple Icons 的官方路径，
 * 省掉一个新依赖 —— 只有这一处用，24×24 的 viewBox 与 lucide 一致，混着摆不违和。
 */
function GithubMark(): JSX.Element {
  return (
    <svg role="img" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

/**
 * 自动更新的提示条，浮在窗口右下角。
 *
 * 为什么不占内容区顶部：更新是异步事件，而用户多半正在出包流程里。摆在内容流里会把
 * 页面往下顶、把「输入 APK」那一块推走，可这件事并不需要立即处理 —— 放角落才不打断。
 *
 * 只有安装版才会真的出现（不是安装包装出来的版本没有安装目录，见主进程 updater.ts）。
 * 三个阶段各有去处：
 *   available   —— 发现新版本，把「更新了什么」摆出来，下不下由用户点
 *   downloading —— 进度条
 *   downloaded  —— 「立即重启并更新」
 * 其余一律不占位置：「已经是最新」与「检查失败」只会在用户自己点过「检查更新」
 * 之后用一句提示收尾，免得每次启动都冒出「已是最新」这种没人问的话。
 *
 * 点「稍后」只是把这一条收起来，主进程的状态不动 —— 侧边栏底部的「检查更新」
 * 会跟着阶段变成「下载更新」或「重启并更新」，从那里接着走。
 */
export default function UpdateBanner(): JSX.Element | null {
  const { hasUnsaved, allowUnload } = useNav()
  const [state, setState] = useState<UpdateState | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  // 开源仓库地址；拿不到就是空串，那种情况下不显示跳转按钮
  const [repoUrl, setRepoUrl] = useState('')

  useEffect(() => {
    let cancelled = false

    void window.api.getUpdateState().then((next) => {
      if (!cancelled) {
        setState(next)
      }
    })

    void window.api.getRepoUrl().then((url) => {
      if (!cancelled) {
        setRepoUrl(url)
      }
    })

    const unsubscribe = window.api.onUpdateState((next) => {
      setState(next)
      // 又来一个新版本就重新露头：上一次的「稍后」不该把这一条也压住
      if (next.phase === 'available') {
        setDismissed(false)
      }
    })

    /*
     * 侧边栏那个按钮在「已下载」阶段点一下会发这个事件 —— 重启前要核对未保存的改动
     * 与正在跑的任务，那段判断在这里，所以它把提示条叫回来，而不是自己走一遍。
     */
    const reveal = (): void => setDismissed(false)
    window.addEventListener('update:reveal', reveal)

    return () => {
      cancelled = true
      unsubscribe()
      window.removeEventListener('update:reveal', reveal)
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

  const noteSections = offering ? parseNotes(state.releaseNotes) : []

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

  /**
   * 跳到开源仓库。
   *
   * 用 window.open 而不是改 location：主进程的 setWindowOpenHandler 会把它拦下来、
   * 交给系统浏览器，应用自己不会离开当前页面（见 main/main.ts）。
   */
  const openRepo = (): void => {
    window.open(repoUrl, '_blank', 'noopener')
  }

  return (
    <div
      data-slot="update-banner"
      className="fixed right-4 bottom-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm float-shadow"
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
          {noteSections.length > 0 ? (
            <div
              data-slot="update-notes"
              className="max-h-48 overflow-y-auto rounded-md border bg-muted/40 px-2.5 py-2"
            >
              <div className="flex flex-col gap-2.5">
                {noteSections.map((section, sectionIndex) => (
                  <div key={`${section.title}-${sectionIndex}`} className="flex flex-col gap-1">
                    {section.title !== '' ? <NoteSectionTitle title={section.title} /> : null}
                    {section.items.length > 0 ? (
                      <ul className="flex flex-col gap-1 text-xs leading-relaxed text-muted-foreground">
                        {section.items.map((item, itemIndex) => (
                          <li key={itemIndex} className="flex gap-1.5">
                            {/* 用小圆点而不是「• 」字符：换行时悬挂缩进不会错位 */}
                            <span
                              aria-hidden="true"
                              className="mt-1.5 size-1 shrink-0 rounded-full bg-current opacity-60"
                            />
                            <span className="min-w-0">{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
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
          {repoUrl !== '' ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="在浏览器中打开开源仓库"
              title="在浏览器中打开开源仓库"
              onClick={openRepo}
            >
              <GithubMark />
            </Button>
          ) : null}
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
          {repoUrl !== '' ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="在浏览器中打开开源仓库"
              title="在浏览器中打开开源仓库"
              onClick={openRepo}
            >
              <GithubMark />
            </Button>
          ) : null}
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
