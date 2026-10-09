import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { RuntimeCheckResult } from '@shared/types/runtime'

type CheckState =
  | { status: 'loading' }
  | { status: 'ok' }
  | { status: 'missing'; result: RuntimeCheckResult }
  | { status: 'error'; message: string }

function formatSize(bytes: number): string {
  if (bytes <= 0) {
    return '0 B'
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 内置运行时缺失时的顶部横幅。
 * 缺组件不影响应用启动 —— 只是出包不可用，所以这里不拦窗口，只把缺哪一项、
 * 期望在什么路径说清楚，避免使用者对着一次失败的分包任务猜原因。
 *
 * 用 warning 而不是 destructive：应用本身是好的，看渠道、改配置都能用，
 * 全红渲染会让人以为整个工具坏了。
 */
export default function RuntimeBanner(): JSX.Element | null {
  const [state, setState] = useState<CheckState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    window.api
      .checkRuntime()
      .then((result) => {
        if (cancelled) {
          return
        }
        setState(result.ok ? { status: 'ok' } : { status: 'missing', result })
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        // 自检本身失败也要说出来，否则界面看起来一切正常，问题却被吞掉
        const message = error instanceof Error ? error.message : String(error)
        setState({ status: 'error', message })
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading' || state.status === 'ok') {
    return null
  }

  if (state.status === 'error') {
    return (
      <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
        <div className="flex items-center gap-2 font-medium">
          <TriangleAlert className="size-4" />
          内置运行时自检失败
        </div>
        <p className="mt-1 pl-6 text-xs">{state.message}</p>
      </div>
    )
  }

  const missing = state.result.components.filter((component) => !component.exists)

  return (
    <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
      <div className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-4" />
        运行环境不完整，暂时无法出包
      </div>
      <ul className="mt-1 space-y-0.5 pl-6 text-xs">
        {missing.map((component) => (
          <li key={component.key}>
            {component.label}：{component.path}
            {component.sizeBytes > 0 ? `（${formatSize(component.sizeBytes)}）` : '（文件不存在）'}
          </li>
        ))}
      </ul>
      <p className="mt-1 pl-6 text-xs">
        缺少 {missing.length} 项。这些文件应位于：{state.result.binDir}。重新安装或换用完整安装包可以补齐。
      </p>
    </div>
  )
}
