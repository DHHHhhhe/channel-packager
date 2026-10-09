import { useState } from 'react'
import { Check, Copy, FolderOpen, KeyRound, ListTree, Package, ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import { ThemeToggle } from '@/components/ThemeToggle'
import { cn } from '@/lib/utils'

export type AppView = 'pack' | 'jks' | 'channels' | 'template'

export interface NavItem {
  view: AppView
  label: string
  hint: string
  icon: typeof Package
}

export const NAV_ITEMS: readonly NavItem[] = [
  { view: 'pack', label: '出包', hint: '选 APK 与渠道，开始出包', icon: Package },
  { view: 'jks', label: '签名配置', hint: '管理签名文件与密码', icon: KeyRound },
  { view: 'channels', label: '渠道配置', hint: '维护分组与渠道列表', icon: ListTree },
  { view: 'template', label: '模板与配置包', hint: '后缀模板、导入导出配置', icon: ScrollText },
]

export function viewTitle(view: AppView): string {
  return NAV_ITEMS.find((item) => item.view === view)?.label ?? '渠道分包工具'
}

interface AppSidebarProps {
  active: AppView
  onSelect: (view: AppView) => void
  dataDir: string
  jksCount: number
  groupCount: number
}

export function AppSidebar({
  active,
  onSelect,
  dataDir,
  jksCount,
  groupCount,
}: AppSidebarProps) {
  const [copied, setCopied] = useState(false)

  const copyDataDir = async (): Promise<void> => {
    try {
      await window.api.writeClipboard(dataDir)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('复制失败，请手动选中路径')
    }
  }

  return (
    <aside className="flex w-[var(--sidebar-width)] shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-[var(--topbar-height)] shrink-0 items-center gap-2 border-b px-4">
        <Package className="size-4 shrink-0" />
        <span className="text-sm font-medium">渠道分包工具</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {NAV_ITEMS.map((item, index) => {
          const Icon = item.icon
          const isActive = item.view === active
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => onSelect(item.view)}
              aria-current={isActive ? 'page' : undefined}
              title={`${item.label}（Ctrl+${index + 1}）`}
              className={cn(
                'flex flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors',
                'focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'hover:bg-sidebar-accent/60',
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon className="size-4 shrink-0" />
                {item.label}
              </span>
              <span className="pl-6 text-xs text-muted-foreground">{item.hint}</span>
            </button>
          )
        })}
      </nav>

      <div className="shrink-0 border-t p-3">
        <div className="flex items-center justify-between gap-2 pb-2">
          <span className="text-xs text-muted-foreground">主题</span>
          <ThemeToggle />
        </div>

        {/*
         * 数据目录做成可点、可复制。
         * 这个路径的用处是「去里面看看渠道文件长什么样」「备份一份」「发给同事
         * 让他照着放」—— 原来只是一行截断的文字，人只能照着念一遍再手敲。
         */}
        <div className="flex items-start gap-1 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => void window.api.openPath(dataDir)}
            disabled={dataDir === ''}
            title={dataDir ? `在文件资源管理器里打开：${dataDir}` : '数据目录未就绪'}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <FolderOpen className="size-3.5 shrink-0" />
            <span className="truncate">{dataDir || '数据目录未就绪'}</span>
          </button>
          <button
            type="button"
            onClick={() => void copyDataDir()}
            disabled={dataDir === ''}
            aria-label="复制数据目录路径"
            title="复制数据目录路径"
            className="shrink-0 rounded p-0.5 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </button>
        </div>

        <div className="flex items-center gap-1 pt-1 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => onSelect('jks')}
            title="去「签名配置」"
            className="rounded px-1 py-0.5 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
          >
            {jksCount} 个签名文件
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => onSelect('channels')}
            title="去「渠道配置」"
            className="rounded px-1 py-0.5 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
          >
            {groupCount} 个分组
          </button>
        </div>
      </div>
    </aside>
  )
}
