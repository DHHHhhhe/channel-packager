import { useEffect, useMemo, useRef, useState } from 'react'
import { Info, Sparkles, TrendingUp, Wrench } from 'lucide-react'
import { GithubMark } from '@/components/icons/GithubMark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { parseChangelog } from '@/lib/changelog'
import changelogRaw from '../../../../CHANGELOG.md?raw'

interface ChangelogDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 当前运行的版本，用来在列表里标出来 */
  currentVersion: string
}

/**
 * 每种改动类型的标记。
 *
 * 分类标题原来是一行灰色小字，一屏里「新增」「修复」长得一模一样，扫读时分不出
 * 哪几类是重点。改成带色的小标签 —— 颜色只用语义色（见 DESIGN.md：状态色一律
 * 浅底 + 同色深字），不引入装饰色。
 *
 * 认不出的分类退回中性样式，仍然显示原文，不丢内容。
 */
const SECTION_STYLE: Record<
  string,
  { variant: 'success' | 'info' | 'warning' | 'secondary'; Icon: typeof Sparkles }
> = {
  新增: { variant: 'success', Icon: Sparkles },
  优化: { variant: 'info', Icon: TrendingUp },
  修复: { variant: 'warning', Icon: Wrench },
  说明: { variant: 'secondary', Icon: Info },
}

/**
 * 每页几个版本。
 *
 * 对话框的内容区是 60vh，一屏大约放得下两个版本，所以 5 个意味着「翻一页要滚两下」——
 * 再多就得滚很久才看得完一页，再少则翻页太频繁。
 */
const PAGE_SIZE = 5

/**
 * 更新记录。历次版本的改动说明，最新的在最前。
 *
 * 内容来自仓库里的 CHANGELOG.md，构建时被 `?raw` 内联进包 —— 所以断网也能看。
 * 不走 GitHub API 是有意的：这个工具常在内网分发，从外面拉一份列表未必拿得到，
 * 而「这版改了什么」恰恰是装不上网的那台机器更需要知道的事。
 *
 * 分页而不是一次全渲染：版本数是会一直涨的，一屏里塞几十个版本既滚不完也定位不到。
 * 分页还能顺带压住「模态里滚动、关掉再开忘了滚到哪」这个毛病。
 */
export function ChangelogDialog({
  open,
  onOpenChange,
  currentVersion,
}: ChangelogDialogProps): React.JSX.Element {
  // CHANGELOG 是构建期就定下来的常量，解析一次就够，不必跟着开合重算
  const entries = useMemo(() => parseChangelog(changelogRaw), [])
  const [page, setPage] = useState(0)
  // 开源仓库地址；拿不到就是空串，那种情况下不显示跳转按钮
  const [repoUrl, setRepoUrl] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.getRepoUrl().then((url) => {
      if (!cancelled) {
        setRepoUrl(url)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * 跳到开源仓库。
   *
   * 用 window.open 而不是改 location：主进程的 setWindowOpenHandler 会把它拦下来、
   * 交给系统浏览器，应用自己不会离开当前页面（见 main/main.ts）。
   */
  const openRepo = (): void => {
    window.open(repoUrl, '_blank', 'noopener')
  }

  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  // 夹一下：CHANGELOG 变短时（比如换了包）不至于停在一个不存在的页上
  const safePage = Math.min(page, pageCount - 1)
  const visible = entries.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  /*
   * 每次打开都定位到当前版本那一页 —— 那是最可能想看的。
   * 也顺手把上一次翻到的页码清掉，否则关了再开还停在半年前的某页上。
   */
  useEffect(() => {
    if (!open) {
      return
    }
    const index = entries.findIndex((entry) => entry.version === currentVersion)
    setPage(index >= 0 ? Math.floor(index / PAGE_SIZE) : 0)
  }, [open, entries, currentVersion])

  /**
   * 翻页。
   *
   * 用函数式更新而不是 `setPage(safePage + 1)`：后者的 safePage 是这次渲染时的旧值，
   * 用户连点两下会都基于同一个旧值算，结果只前进一步（实测过）。
   */
  const step = (delta: number): void => {
    setPage((current) => Math.min(Math.max(current + delta, 0), pageCount - 1))
    // 翻页后回到顶部，否则新一页会从中间开始显示
    listRef.current?.scrollTo({ top: 0 })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onOpenChange(false))}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>更新记录</DialogTitle>
          <DialogDescription>
            共 {entries.length} 个版本，最新的在最前。
          </DialogDescription>
        </DialogHeader>

        {/*
         * 滚动区收在 60vh：窗口最小能缩到 680px 高，再高一点标题栏和翻页条就会被挤出去。
         * -mx-1 + px-1 给滚动条留出位置，免得它贴着卡片边缘。
         */}
        <div ref={listRef} className="-mx-1 max-h-[52vh] overflow-y-auto px-1">
          {visible.map((entry) => {
            const isCurrent = entry.version === currentVersion
            return (
              <section
                key={entry.version}
                className="border-b border-border py-4 first:pt-0 last:border-b-0 last:pb-0"
              >
                <header className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold tabular-nums">v{entry.version}</h3>
                  <time className="text-xs text-muted-foreground tabular-nums">{entry.date}</time>
                  {isCurrent ? (
                    <Badge variant="secondary" className="ml-auto">
                      当前版本
                    </Badge>
                  ) : null}
                </header>

                {entry.sections.map((section, sectionIndex) => {
                  const style = SECTION_STYLE[section.title]
                  return (
                    <div key={`${section.title}-${sectionIndex}`} className="mt-3">
                      {section.title ? (
                        style ? (
                          <Badge variant={style.variant}>
                            <style.Icon />
                            {section.title}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{section.title}</Badge>
                        )
                      ) : null}
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {section.items.map((item, itemIndex) => (
                          <li
                            key={`${itemIndex}-${item.slice(0, 12)}`}
                            className="flex gap-2 text-sm leading-relaxed"
                          >
                            <span
                              aria-hidden="true"
                              className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/40"
                            />
                            <span className="min-w-0 break-words">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </section>
            )
          })}
        </div>

        {/*
         * 只有一页时不出现翻页条 —— 摆着两个永远点不动的按钮没有意义。
         * 但仓库入口得有地方放，所以只要拿到了地址，这一条就仍然出现。
         */}
        {pageCount > 1 || repoUrl !== '' ? (
          <DialogFooter className="items-center sm:justify-between">
            {pageCount > 1 ? (
              <p className="text-xs text-muted-foreground tabular-nums">
                第 {safePage * PAGE_SIZE + 1}–{Math.min(entries.length, (safePage + 1) * PAGE_SIZE)} 条，
                共 {entries.length} 个版本
              </p>
            ) : (
              // 占位：justify-between 要有两个子元素才能把右侧推到边上
              <span />
            )}
            <div className="flex items-center gap-2">
              {pageCount > 1 ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safePage === 0}
                    onClick={() => step(-1)}
                  >
                    上一页
                  </Button>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {safePage + 1} / {pageCount}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => step(1)}
                  >
                    下一页
                  </Button>
                </>
              ) : null}
              {repoUrl !== '' ? (
                <Button
                  type="button"
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
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
