import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

/** 宽度上下限。下限保证导航项的文字还放得下，上限避免侧栏把内容挤没 */
const MIN_WIDTH = 200
const MAX_WIDTH = 420
const STORAGE_KEY = 'channel-packager:sidebar-width'

function clampWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)))
}

/*
 * 读上次存的宽度。localStorage 在隐私模式或被策略禁用时会直接抛，
 * 所以整段包在 try 里 —— 存不了宽度只是少个便利，不该让侧栏渲染不出来。
 */
function readStoredWidth(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      return null
    }
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? clampWidth(parsed) : null
  } catch {
    return null
  }
}

function writeStoredWidth(value: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    /* 存不了就算了，本次会话内的拖动照样有效 */
  }
}

/**
 * 侧边栏宽度拖动手柄。
 *
 * 监听挂在 document 上，不挂在手柄自己身上。手柄只有 5px 宽，光标拖快一点就会离开它；
 * 挂在手柄上时浏览器不再派发后续事件，表现是光标卡在 col-resize、侧栏不再跟随，
 * 只能刷新页面。挂到 document 上就不受光标位置影响。
 *
 * 拖动过程中宽度直接写到 <aside> 元素上，而不是改 :root 的自定义属性 ——
 * 在整棵文档上改自定义属性会触发全树样式重算，拖动会掉帧。
 * 松手时才写 localStorage，不是每帧都写。
 *
 * 除了鼠标拖动，也支持键盘：手柄可聚焦，左右方向键每次 16px，Home/End 到两端。
 */
export function SidebarResizer({ targetRef }: { targetRef: React.RefObject<HTMLElement | null> }) {
  const [dragging, setDragging] = useState(false)
  const [width, setWidth] = useState(() => readStoredWidth() ?? 0)

  /* 首帧之前把存的宽度放上去，否则会先按默认宽度画一帧再跳过去 */
  useLayoutEffect(() => {
    const target = targetRef.current
    if (target !== null && width > 0) {
      target.style.width = `${width}px`
    }
    // 只在挂载时执行一次：后续宽度由拖动流程自己写
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyWidth = useCallback(
    (next: number): number => {
      const clamped = clampWidth(next)
      const target = targetRef.current
      if (target !== null) {
        target.style.width = `${clamped}px`
      }
      return clamped
    },
    [targetRef],
  )

  useEffect(() => {
    if (!dragging) {
      return
    }

    /*
     * 拖到窗口外面也还能继续拖，所以两个事件都绑在 document 上。
     * 顺手禁掉文本选中，否则快速拖动会把整个侧栏的文字刷蓝。
     */
    const previousUserSelect = document.body.style.userSelect
    const previousCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    const onMove = (event: PointerEvent): void => {
      const target = targetRef.current
      if (target === null) {
        return
      }
      /*
       * 用侧栏自身的左边缘算宽度，而不是用 pointer 的位移量累加 ——
       * 累加会把每一帧的取整误差攒起来，拖久了宽度和光标就对不上。
       */
      const left = target.getBoundingClientRect().left
      setWidth(applyWidth(event.clientX - left))
    }

    const finish = (): void => {
      setDragging(false)
      setWidth((current) => {
        if (current > 0) {
          writeStoredWidth(current)
        }
        return current
      })
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', finish)
    /* 触控笔被系统中断时不会发 pointerup，不处理的话会一直卡在拖动状态 */
    document.addEventListener('pointercancel', finish)

    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', finish)
      document.removeEventListener('pointercancel', finish)
      document.body.style.userSelect = previousUserSelect
      document.body.style.cursor = previousCursor
    }
  }, [dragging, applyWidth, targetRef])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const current = targetRef.current?.getBoundingClientRect().width ?? width
    const step = event.shiftKey ? 48 : 16

    if (event.key === 'ArrowLeft') {
      setWidth(applyWidth(current - step))
    } else if (event.key === 'ArrowRight') {
      setWidth(applyWidth(current + step))
    } else if (event.key === 'Home') {
      setWidth(applyWidth(MIN_WIDTH))
    } else if (event.key === 'End') {
      setWidth(applyWidth(MAX_WIDTH))
    } else {
      return
    }

    event.preventDefault()
    setWidth((latest) => {
      writeStoredWidth(latest)
      return latest
    })
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧边栏宽度"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width > 0 ? width : undefined}
      tabIndex={0}
      onPointerDown={(event) => {
        /* 只响应主键：右键和中键不该触发拖动 */
        if (event.button !== 0) {
          return
        }
        event.preventDefault()
        setDragging(true)
      }}
      onKeyDown={onKeyDown}
      className="group/resizer absolute inset-y-0 -right-1 z-10 flex w-2 cursor-col-resize touch-none items-center justify-center outline-none"
    >
      {/*
       * 视觉上只有 1px，但可点区域是上面那个 8px 宽的容器 ——
       * 1px 的线用鼠标很难抓，而做成 8px 的粗线又难看。
       */}
      <span
        aria-hidden="true"
        className={
          dragging
            ? 'h-full w-px bg-primary'
            : 'h-full w-px bg-transparent transition-colors duration-150 group-hover/resizer:bg-border group-focus-visible/resizer:bg-primary'
        }
      />
    </div>
  )
}
