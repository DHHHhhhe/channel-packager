import { useState } from 'react'
import type { JSX } from 'react'
import { FolderOpen, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/app-store'

/**
 * 「配置文件在、但读不出来」的提示条。
 *
 * 文件不存在不算问题（那是「还没有」），所以这里出现的每一条都值得用户处理 ——
 * 以前这种情况会静默当成空列表，界面只显示「0 个签名文件」，看起来像配置整个丢了。
 */
export default function StoreProblemBanner(): JSX.Element | null {
  const { problems, dataDir } = useAppStore()
  const [dismissed, setDismissed] = useState<string[]>([])
  const [openError, setOpenError] = useState('')

  const visible = problems.filter((problem) => !dismissed.includes(problem.path))
  if (visible.length === 0) {
    return null
  }

  const handleOpenDataDir = async (): Promise<void> => {
    const error = await window.api.openPath(dataDir)
    setOpenError(error === '' ? '' : `打不开数据目录：${error}`)
  }

  return (
    <div
      data-slot="store-problem-banner"
      className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
    >
      <div className="flex items-start gap-2 text-destructive">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          有 {visible.length} 个配置文件读不出来，已按空列表继续。
          原文件没有改动，损坏的内容已另行备份；修复或删除后重新打开即可。
        </span>
      </div>

      <ul className="flex flex-col gap-2 pl-6">
        {visible.map((problem) => (
          <li key={problem.path} className="text-xs text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">{problem.label}</span>
              <span className="mx-1">·</span>
              <span>{problem.reason}</span>
            </div>
            <div className="break-all font-mono">{problem.path}</div>
            {problem.backupPath ? (
              <div className="break-all">
                备份：<span className="font-mono">{problem.backupPath}</span>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 pl-6">
        <Button variant="outline" size="sm" onClick={() => void handleOpenDataDir()}>
          <FolderOpen />
          打开数据目录
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDismissed(problems.map((problem) => problem.path))}
        >
          知道了
        </Button>
        {openError !== '' ? (
          <span className="text-xs text-destructive">{openError}</span>
        ) : null}
      </div>
    </div>
  )
}
