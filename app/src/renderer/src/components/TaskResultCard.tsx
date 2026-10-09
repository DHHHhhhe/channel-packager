import { useEffect, useState } from 'react'
import { Copy, FileText, FolderOpen, RotateCcw, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { TaskResult } from '@shared/types/task'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { STAGE_LABELS, buildDiagnostic } from '@/lib/task-report'

interface TaskResultCardProps {
  /** 一次出包的结果。成功与失败共用同一张卡片，只是失败时多一块诊断 */
  result: TaskResult
  /** 「打开输出目录」与「打开日志」都走它；路径不存在时由调用方去提示 */
  onOpenPath: (target: string, what: string) => void | Promise<void>
  /** 只有单次出包的那张卡片给「重跑本次」；队列里的每一项不提供 */
  onRerun?: () => void
  rerunDisabled?: boolean
  /** 队列里用来标明这是第几项；单次出包不传，标题就是「出包完成 / 出包失败」 */
  heading?: string
}

/**
 * 出包结果卡片。
 *
 * 抽成组件是因为出包队列也要给每一项看同一份内容 —— 失败诊断（卡在哪、退出码、
 * 输出末尾、复制诊断信息）是一整套东西，复制两份迟早会改歪一份。
 */
export function TaskResultCard({
  result,
  onOpenPath,
  onRerun,
  rerunDisabled,
  heading,
}: TaskResultCardProps) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')

  // 换了结果就把上一轮的「已复制」撤掉，否则新卡片上会挂着旧提示
  useEffect(() => {
    setCopied(false)
    setCopyError('')
  }, [result])

  // 失败诊断只在失败时存在；提到这里是为了在 JSX 里拿到窄化后的类型
  const failure = result.ok ? undefined : result.failure

  // 输出目录是出包一开始就建的（工作目录在它下面），校验阶段就失败时它才是空的
  const openDirTarget = result.outputDir

  const handleCopy = async (): Promise<void> => {
    try {
      await window.api.writeClipboard(buildDiagnostic(result))
      setCopyError('')
      setCopied(true)
    } catch (error) {
      setCopyError(ipcErrorMessage(error))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {heading ?? (result.ok ? '出包完成' : '出包失败')}
          {result.ok ? <Badge variant="success">{result.artifacts.length} 个包</Badge> : null}
        </CardTitle>
        <CardDescription>
          {result.message}
          {result.outputDir ? ` · 输出目录：${result.outputDir}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onOpenPath(openDirTarget, '输出目录')}
          >
            <FolderOpen />
            打开输出目录
          </Button>
          {onRerun ? (
            <>
              <Button variant="outline" size="sm" onClick={onRerun} disabled={rerunDisabled === true}>
                <RotateCcw />
                重跑本次
              </Button>
              <span className="text-xs text-muted-foreground">
                「重跑本次」只把参数填回上面的表单，不会立刻开跑。
              </span>
            </>
          ) : null}
        </div>

        {result.artifacts.length > 0 ? (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>文件名</TableHead>
                  <TableHead>渠道号</TableHead>
                  <TableHead>别名</TableHead>
                  <TableHead>校验</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.artifacts.map((artifact) => (
                  <TableRow key={artifact.fileName}>
                    <TableCell className="max-w-[20rem] truncate" title={artifact.path}>
                      {artifact.fileName}
                    </TableCell>
                    <TableCell>{artifact.channel || '(空)'}</TableCell>
                    <TableCell>{artifact.alias ?? '—'}</TableCell>
                    <TableCell>
                      {artifact.verified ? (
                        <Badge variant="success">通过</Badge>
                      ) : (
                        <Badge variant="destructive">{artifact.note ?? '未通过'}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        {result.warnings.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
            <div className="flex items-center gap-1.5 text-sm font-medium text-warning">
              <TriangleAlert className="size-4 shrink-0" />
              提醒 {result.warnings.length} 条
            </div>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {failure ? (
          <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
              <span>
                卡在：<span className="font-medium">{STAGE_LABELS[failure.stage]}</span>
              </span>
              {failure.exitCode !== undefined ? (
                <span>
                  退出码：<span className="font-mono">{failure.exitCode}</span>
                </span>
              ) : null}
              {failure.timedOut ? <span>卡住后已强制结束</span> : null}
              <span className="text-muted-foreground">任务号 {result.taskId}</span>
            </div>

            {failure.outputTail && failure.outputTail.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  这个步骤的输出末尾 {failure.outputTail.length} 行：
                </p>
                <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
                  {failure.outputTail.join('\n')}
                </pre>
              </>
            ) : failure.timedOut ? (
              <p className="text-sm text-muted-foreground">
                这个进程从头到尾一个字都没输出，等到超时就被强制结束了 —— 日志里能看到它停在哪个动作上。
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                这一步没有子进程输出 —— 报错来自程序自己的检查，不用去日志里找。
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void handleCopy()}>
                <Copy />
                复制诊断信息
              </Button>
              <span className="text-xs text-muted-foreground">
                {copyError !== ''
                  ? `复制失败：${copyError}`
                  : copied
                    ? '已复制。路径里的用户目录已替换成 %USERPROFILE%'
                    : '复制的内容里，路径的用户目录会替换成 %USERPROFILE%'}
              </span>
            </div>

            {result.workDir !== '' ? (
              <p className="text-xs text-muted-foreground">
                工作目录（失败时保留，可对着中间产物排查）：{result.workDir}
              </p>
            ) : null}
          </div>
        ) : null}

        {/*
          这里不用 Button：日志路径要能折行（`whitespace-nowrap` 写在 Button 的基类里，
          再叠一个 whitespace-normal 谁赢取决于 Tailwind 的生成顺序，不保险）。
        */}
        <div className="flex flex-wrap items-baseline gap-1 text-xs text-muted-foreground">
          <span>日志：</span>
          <button
            type="button"
            onClick={() => void onOpenPath(result.logFile, '日志')}
            title="用系统默认程序打开这份日志"
            className="inline-flex items-baseline gap-1 break-all text-left font-mono text-primary underline-offset-4 hover:underline"
          >
            <FileText className="size-3.5 shrink-0 self-center" />
            {result.logFile}
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
