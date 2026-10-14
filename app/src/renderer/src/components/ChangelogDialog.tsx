import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
 * 更新记录。历次版本的改动说明，最新的在最前。
 *
 * 内容来自仓库里的 CHANGELOG.md，构建时被 `?raw` 内联进包 —— 所以断网也能看。
 * 不走 GitHub API 是有意的：这个工具常在内网分发，从外面拉一份列表未必拿得到，
 * 而「这版改了什么」恰恰是装不上网的那台机器更需要知道的事。
 */
export function ChangelogDialog({
  open,
  onOpenChange,
  currentVersion,
}: ChangelogDialogProps): React.JSX.Element {
  // CHANGELOG 是构建期就定下来的常量，解析一次就够，不必跟着开合重算
  const entries = useMemo(() => parseChangelog(changelogRaw), [])

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
         * 滚动区收在 60vh：窗口最小能缩到 680px 高，再高一点标题栏和按钮就会被挤出去。
         * -mx-1 + px-1 给滚动条留出位置，免得它贴着卡片边缘。
         */}
        <div className="-mx-1 max-h-[60vh] overflow-y-auto px-1">
          {entries.map((entry) => {
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

                {entry.sections.map((section, sectionIndex) => (
                  <div key={`${section.title}-${sectionIndex}`} className="mt-3">
                    {section.title ? (
                      <h4 className="text-xs font-medium text-muted-foreground">{section.title}</h4>
                    ) : null}
                    <ul className="mt-1.5 flex flex-col gap-1.5">
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
                ))}
              </section>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
