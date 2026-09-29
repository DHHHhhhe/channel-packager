import type { JSX } from 'react'
import RuntimeBanner from './components/RuntimeBanner'

/**
 * 阶段 1 的外壳：只加了运行时自检横幅。
 * 主界面在阶段 4 接入（出包 / jks / 渠道 / 模板四个界面）。
 */
export default function App(): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <RuntimeBanner />
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-neutral-900">渠道分包工具</h1>
          <p className="mt-2 text-sm text-neutral-500">工程骨架已就位，界面将在后续阶段接入。</p>
        </div>
      </div>
    </div>
  )
}
