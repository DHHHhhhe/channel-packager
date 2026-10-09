import { FolderOpen, KeyRound, ListTree, Package, ScrollText } from 'lucide-react'
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
  return (
    <aside className="flex w-[var(--sidebar-width)] shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-[var(--topbar-height)] shrink-0 items-center gap-2 border-b px-4">
        <Package className="size-4 shrink-0" />
        <span className="text-sm font-medium">渠道分包工具</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = item.view === active
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => onSelect(item.view)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors',
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
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <FolderOpen className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0">
            <div>
              {jksCount} 个签名文件 · {groupCount} 个分组
            </div>
            <div className="truncate" title={dataDir}>
              {dataDir || '数据目录未就绪'}
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
