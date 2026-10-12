import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'
import { NAV_ITEMS, type AppView } from '@/components/AppSidebar'

/*
 * 页面切换放在 context 里，而不是一路当 prop 传。
 *
 * 起因是「空态要能一键跳到目标页」—— 渠道配置页空列表时提示「先去签名配置
 * 新增 jks」，光有文字没有入口，人得自己找侧边栏。那个按钮埋在 PairListEditor
 * 外面好几层，逐层透传 onNavigate 会把一堆组件改成中转站。
 *
 * 后来又多了 Ctrl+1..4 / Ctrl+S 这类全局按键。
 *
 * 注意：切页**不再**拦未保存的改动。四个页面现在是一直挂着的（见 App.tsx 的
 * ViewStack），切走再切回来，编辑到一半的内容原样还在 —— 再弹「离开就会丢掉」
 * 就是句假话，只会白挡一道。真正会丢的只剩「关窗口」，那一条留在下面。
 */
interface NavValue {
  view: AppView
  /** 切页 */
  go: (view: AppView) => void
  /** 内部用：按调用方注册「未保存改动」的描述，null 表示清掉 */
  setUnsaved: (key: string, label: string | null) => void
  /** 内部用：按页面注册保存动作，Ctrl+S 只会调当前页那一个 */
  setSaveHandler: (view: AppView, handler: (() => void) | null) => void
  /** 现在有没有没保存的修改。安装更新要重启进程，界面得先问一句 */
  hasUnsaved: () => boolean
  /** 内部用：放行一次关窗口。调用方必须先跟用户确认过改动会丢 */
  allowUnload: () => void
}

const NavContext = createContext<NavValue | null>(null)

export function NavProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<AppView>('pack')

  /*
   * 未保存标记与保存动作都只放在 ref 里，不放在 state：
   * 关窗口的监听器只在挂载时注册一次，闭包抓到的 state 会过期；而这两样变化时
   * 也不需要重渲染。
   *
   * 用 Map 而不是单个值：四个页面一直挂着，谁有未保存内容谁就往里写一条，
   * 共用一个槽位会被最后渲染的那个页面盖掉。
   */
  const unsavedRef = useRef<Map<string, string>>(new Map())
  const saveRef = useRef<Map<AppView, () => void>>(new Map())
  const allowUnloadRef = useRef(false)
  const viewRef = useRef(view)
  viewRef.current = view

  const hasUnsaved = useCallback(() => unsavedRef.current.size > 0, [])

  const allowUnload = useCallback(() => {
    allowUnloadRef.current = true
  }, [])

  const setUnsaved = useCallback((key: string, label: string | null) => {
    if (label === null) {
      unsavedRef.current.delete(key)
      return
    }
    unsavedRef.current.set(key, label)
  }, [])

  const setSaveHandler = useCallback((target: AppView, handler: (() => void) | null) => {
    if (handler === null) {
      saveRef.current.delete(target)
      return
    }
    saveRef.current.set(target, handler)
  }, [])

  const go = useCallback((next: AppView) => {
    if (next === viewRef.current) {
      return
    }
    setView(next)
  }, [])

  /* Ctrl+1..4 切页，Ctrl+S 保存 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        return
      }
      if (event.key === 's' || event.key === 'S') {
        const handler = saveRef.current.get(viewRef.current)
        if (handler) {
          // 不拦的话这个按键会继续冒泡；输入框里的 Ctrl+S 也该是「保存」而不是别的
          event.preventDefault()
          handler()
        }
        return
      }
      const index = Number(event.key)
      if (!Number.isInteger(index) || index < 1 || index > NAV_ITEMS.length) {
        return
      }
      event.preventDefault()
      go(NAV_ITEMS[index - 1].view)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [go])

  /*
   * 菜单里的「页面」那一栏：键位显示在菜单上，点了也走同一条路。
   *
   * 菜单项没让系统注册快捷键（registerAccelerator: false），所以按 Ctrl+1 还是
   * 上面那个监听器在处理，这里只接鼠标点击。
   */
  useEffect(() => {
    return window.api.onNavCommand((command) => {
      if (command === 'save') {
        saveRef.current.get(viewRef.current)?.()
        return
      }
      const item = NAV_ITEMS.find((entry) => entry.view === command)
      if (item) {
        go(item.view)
      }
    })
  }, [go])

  /*
   * 关窗口是唯一还会丢东西的出口，拦一下。
   *
   * 拦住之后 Electron 会取消这次关闭，窗口什么反应都没有 —— 所以顺手弹一句提示，
   * 否则人只会以为程序卡死了。浏览器不允许自定义那个原生确认框的文案，
   * 说明只能由我们自己给。
   */
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowUnloadRef.current || unsavedRef.current.size === 0) {
        return
      }
      event.preventDefault()
      event.returnValue = ''
      toast.warning('还有未保存的修改，保存后再关闭窗口。', { id: 'unsaved-before-unload' })
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const value = useMemo<NavValue>(
    () => ({ view, go, setUnsaved, setSaveHandler, hasUnsaved, allowUnload }),
    [view, go, setUnsaved, setSaveHandler, hasUnsaved, allowUnload],
  )

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>
}

export function useNav(): NavValue {
  const value = useContext(NavContext)
  if (!value) {
    throw new Error('useNav 必须在 NavProvider 内使用')
  }
  return value
}

/**
 * 页面用它声明「现在手里有没有没保存的东西」。有的话，关窗口会先拦一下。
 * 传 null 表示没有 —— 绝大多数时候都是 null。
 *
 * 切页不拦：页面是一直挂着的，切走再切回来内容还在。
 */
export function useUnsavedGuard(label: string | null): void {
  const { setUnsaved } = useNav()
  // 每个组件实例一个稳定的键：几个页面同时挂着，不能共用一个槽位
  const key = useId()
  useEffect(() => {
    setUnsaved(key, label)
    return () => setUnsaved(key, null)
  }, [key, label, setUnsaved])
}

/**
 * 注册 Ctrl+S 要执行的动作，按页面注册。
 *
 * 必须带上自己的页面 id：四个页面一直挂着，只按「最后一个注册的」来存，
 * 在渠道配置页按 Ctrl+S 会去存模板页的东西。
 *
 * handler 传 useCallback 包好的稳定引用，否则每次渲染都会重挂一次监听。
 */
export function useSaveShortcut(view: AppView, handler: (() => void) | null): void {
  const { setSaveHandler } = useNav()
  useEffect(() => {
    setSaveHandler(view, handler)
    return () => setSaveHandler(view, null)
  }, [view, handler, setSaveHandler])
}
