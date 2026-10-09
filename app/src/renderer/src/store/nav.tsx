import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NAV_ITEMS, viewTitle, type AppView } from '@/components/AppSidebar'

/*
 * 页面切换放在 context 里，而不是一路当 prop 传。
 *
 * 起因是「空态要能一键跳到目标页」—— 渠道配置页空列表时提示「先去签名配置
 * 新增 jks」，光有文字没有入口，人得自己找侧边栏。那个按钮埋在 PairListEditor
 * 外面好几层，逐层透传 onNavigate 会把一堆组件改成中转站。
 *
 * 后来这里又多了两件「只有最外层才知道该不该做」的事：离开页面前拦一下未保存
 * 的改动，以及 Ctrl+1..4 / Ctrl+S 这类全局按键。
 */
interface NavValue {
  view: AppView
  /** 切页。当前页声明了未保存改动时会先弹确认框，确认后才真的切 */
  go: (view: AppView) => void
  /** 内部用：注册「未保存改动」的描述，null 表示没有 */
  setUnsaved: (label: string | null) => void
  /** 内部用：注册当前页的保存动作，Ctrl+S 会调它 */
  setSaveHandler: (handler: (() => void) | null) => void
}

const NavContext = createContext<NavValue | null>(null)

export function NavProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<AppView>('pack')
  const [blocked, setBlocked] = useState<{ target: AppView; label: string } | null>(null)

  /*
   * 未保存标记与保存动作都只放在 ref 里，不放在 state：
   * 按键与切页的监听器只在挂载时注册一次，闭包抓到的 state 会过期；而这两样
   * 变化时也不需要重渲染（弹框用的是按下那一刻捕获的 label）。
   */
  const unsavedRef = useRef<string | null>(null)
  const saveRef = useRef<(() => void) | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  const setUnsaved = useCallback((label: string | null) => {
    unsavedRef.current = label
  }, [])

  const setSaveHandler = useCallback((handler: (() => void) | null) => {
    saveRef.current = handler
  }, [])

  const go = useCallback((next: AppView) => {
    if (next === viewRef.current) {
      return
    }
    const label = unsavedRef.current
    if (label !== null) {
      setBlocked({ target: next, label })
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
        const handler = saveRef.current
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
   * 关窗口也拦一下。beforeunload 是唯一能拦住「点右上角叉」的钩子 ——
   * 那不是页内导航，管切页的那套逻辑看不到它。
   */
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (unsavedRef.current === null) {
        return
      }
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const value = useMemo<NavValue>(
    () => ({ view, go, setUnsaved, setSaveHandler }),
    [view, go, setUnsaved, setSaveHandler],
  )

  return (
    <NavContext.Provider value={value}>
      {children}

      <ConfirmDialog
        open={blocked !== null}
        onOpenChange={(open) => {
          if (!open) {
            setBlocked(null)
          }
        }}
        title="有还没保存的修改"
        description={
          blocked
            ? `「${viewTitle(viewRef.current)}」里${blocked.label}还没保存，离开这个页面就会丢掉。`
            : ''
        }
        warning="想留下就先取消，再点页面上的保存。"
        confirmText="放弃修改并离开"
        cancelText="留下继续编辑"
        destructive
        onConfirm={() => {
          const target = blocked?.target
          setBlocked(null)
          setUnsaved(null)
          if (target) {
            setView(target)
          }
        }}
      />
    </NavContext.Provider>
  )
}

export function useNav(): NavValue {
  const value = useContext(NavContext)
  if (!value) {
    throw new Error('useNav 必须在 NavProvider 内使用')
  }
  return value
}

/**
 * 页面用它声明「现在手里有没有没保存的东西」。有的话，切页与关窗口都会先问一声。
 * 传 null 表示没有 —— 绝大多数时候都是 null。
 */
export function useUnsavedGuard(label: string | null): void {
  const { setUnsaved } = useNav()
  useEffect(() => {
    setUnsaved(label)
    return () => setUnsaved(null)
  }, [label, setUnsaved])
}

/**
 * 注册 Ctrl+S 要执行的动作。
 * 传 useCallback 包好的稳定引用，否则每次渲染都会重挂一次监听。
 */
export function useSaveShortcut(handler: (() => void) | null): void {
  const { setSaveHandler } = useNav()
  useEffect(() => {
    setSaveHandler(handler)
    return () => setSaveHandler(null)
  }, [handler, setSaveHandler])
}
