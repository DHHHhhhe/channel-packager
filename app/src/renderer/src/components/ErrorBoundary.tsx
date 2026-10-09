import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * 兜住渲染层的崩溃。
 *
 * 没有这一层时，任意一个组件抛错都会让整个 React 树卸载 —— 界面变成一片空白，
 * 用户看到的是「窗口还在、什么都没了」，连出了什么事都不知道。有它在，至少
 * 能看到一句话和一个重新加载的按钮。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 界面只给人看一句话，完整堆栈留给控制台
    console.error('界面渲染出错', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }

    return (
      <div className="flex h-screen items-center justify-center bg-background p-8 text-foreground">
        <div className="flex w-full max-w-lg flex-col items-start gap-3">
          <p className="flex items-center gap-2 text-base font-medium text-destructive">
            <TriangleAlert className="size-4" />
            界面出错了
          </p>
          <p className="text-sm text-muted-foreground">
            正在跑的出包任务不受影响，但这一页已经没法继续操作。重新加载界面通常就能恢复；如果每次打开都这样，把下面这句话发出来。
          </p>
          <pre className="w-full overflow-x-auto rounded-lg border bg-muted/50 p-3 text-xs whitespace-pre-wrap">
            {error.message}
          </pre>
          <Button onClick={() => window.location.reload()}>重新加载界面</Button>
        </div>
      </div>
    )
  }
}
