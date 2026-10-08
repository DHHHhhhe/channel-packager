import type { ReactNode } from 'react'

interface PageHeaderProps {
  description: string
  actions?: ReactNode
}

/**
 * 页面说明与操作区。这里不放标题：顶栏已经显示了当前页面名，
 * 同一份文案上下渲染两遍是重复的。
 */
export function PageHeader({ description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <p className="min-w-0 text-sm text-muted-foreground">{description}</p>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
