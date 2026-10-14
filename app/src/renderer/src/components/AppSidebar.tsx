import { useRef } from 'react'
import { KeyRound, ListTree, Package, ScrollText } from 'lucide-react'
import logoUrl from '@/assets/logo.png'
import { AutoCheckUpdateToggle } from '@/components/AutoCheckUpdateToggle'
import { SidebarResizer } from '@/components/SidebarResizer'
import { ThemeToggle } from '@/components/ThemeToggle'
import UpdateCheckButton from '@/components/UpdateCheckButton'
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
  /** 当前版本，显示在底部工具行右端 —— 自动更新之后要能看出确实换了版本 */
  appVersion: string
  jksCount: number
  groupCount: number
}

export function AppSidebar({
  active,
  onSelect,
  appVersion,
  jksCount,
  groupCount,
}: AppSidebarProps) {
  /*
   * 家底计数挂在导航项右侧，不再堆在底部当一行文字。
   *
   * 它们本来就是「这一页里有多少东西」，点了也是跳到那一页 —— 与导航项是同一类，
   * 摆到底部等于把导航降级成状态。
   *
   * 计数为 0 照样显示：这是配置家底，不是「有未读要处理」，0 也是有效信息（还没配）。
   * 所以样式做成低调的灰色数字，而不是那种提示「有东西要处理」的高亮徽章。
   */
  const navCounts: Partial<Record<AppView, number>> = { jks: jksCount, channels: groupCount }

  /*
   * 手柄拖动时直接改这个元素的宽度，不走 React state ——
   * 每帧 setState 会让整棵侧栏重渲染，拖起来会顿。
   */
  const asideRef = useRef<HTMLElement>(null)

  return (
    <aside
      ref={asideRef}
      className="relative flex w-[var(--sidebar-width)] shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground"
    >
      <div className="flex h-[var(--topbar-height)] shrink-0 items-center gap-2 border-b px-4">
        {/*
         * 用应用图标当品牌标识，不用 lucide 的通用包裹图标 ——
         * 那个图案说「这是个包裹」，但说不了「一个包分出多个渠道包」。
         */}
        <img src={logoUrl} alt="" className="size-6 shrink-0" />
        <span className="text-sm font-medium">渠道分包工具</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {NAV_ITEMS.map((item, index) => {
          const Icon = item.icon
          const isActive = item.view === active
          const count = navCounts[item.view]
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
                /*
                 * 按下时用背景加深而不是位移：导航项是一整块，位移会带动旁边的内容一起晃。
                 * 激活态与按下态取同一个底色 —— 点当前项时不该再跳一下。
                 */
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'hover:bg-sidebar-accent/60 active:bg-sidebar-accent',
              )}
            >
              <span className="flex w-full items-center gap-2 text-sm font-medium">
                <Icon className="size-4 shrink-0" />
                {item.label}
                {count === undefined ? null : (
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {count}
                  </span>
                )}
              </span>
              <span className="pl-6 text-xs text-muted-foreground">{item.hint}</span>
            </button>
          )
        })}
      </nav>

      <div className="shrink-0 border-t p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">主题</span>
          <ThemeToggle />
        </div>

        <div className="mt-2">
          <AutoCheckUpdateToggle />
        </div>

        {/*
         * 这一块统一成「左列放信息、右列放能点的东西」：三行都是左边静态文字、
         * 右边可点控件（主题切换、自动检查开关、检查更新）。
         *
         * 之前是反的（检查更新在左、版本号在右），于是左列上静下动、右列上动下静，
         * 可点性正好交叉 —— 扫一眼看不出规律，只能逐个 hover 去试。静态文字与
         * 可点元素共用一套视觉处理是可点性的典型毛病，NN/g 的建议是两者绝不能用
         * 同一种外观。
         *
         * -mr-2 抵消按钮自身的右内边距，让它的右端与上面那组主题切换对齐。
         */}
        <div className="mt-2 flex items-center justify-between gap-2">
          {appVersion ? (
            <span className="text-xs text-muted-foreground" title={`当前版本 ${appVersion}`}>
              v{appVersion}
            </span>
          ) : null}

          <div className="-mr-2 flex items-center">
            <UpdateCheckButton />
          </div>
        </div>
      </div>

      <SidebarResizer targetRef={asideRef} />
    </aside>
  )
}
