import type { JSX } from 'react'

/**
 * 阶段 0 的占位外壳：只验证 React + Tailwind + Electron 三层通了。
 * 界面在阶段 4 接入（出包 / jks / 渠道 / 模板四个界面）。
 */
export default function App(): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-neutral-900">渠道分包工具</h1>
        <p className="mt-2 text-sm text-neutral-500">工程骨架已就位，界面将在后续阶段接入。</p>
      </div>
    </div>
  )
}
