import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { AppView } from '@/components/AppSidebar'

/*
 * 页面切换放在 context 里，而不是一路当 prop 传。
 *
 * 起因是「空态要能一键跳到目标页」—— 渠道配置页空列表时提示「先去签名配置
 * 新增 jks」，光有文字没有入口，人得自己找侧边栏。那个按钮埋在 PairListEditor
 * 外面好几层，逐层透传 onNavigate 会把一堆组件改成中转站。
 */
interface NavValue {
  view: AppView
  go: (view: AppView) => void
}

const NavContext = createContext<NavValue | null>(null)

export function NavProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<AppView>('pack')
  const value = useMemo<NavValue>(() => ({ view, go: setView }), [view])
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>
}

export function useNav(): NavValue {
  const value = useContext(NavContext)
  if (!value) {
    throw new Error('useNav 必须在 NavProvider 内使用')
  }
  return value
}
