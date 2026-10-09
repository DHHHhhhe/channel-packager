import { useState } from 'react'
import { ListChecks, Play, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TaskResultCard } from '@/components/TaskResultCard'
import type { TaskInput, TaskResult } from '@shared/types/task'

export type QueueStatus = 'pending' | 'running' | 'done' | 'failed'

export interface QueueItem {
  /** 只在本页面内用来认行，不落盘 */
  id: string
  /** 加入队列那一刻的表单参数，之后改表单不会影响它 */
  params: TaskInput
  /**
   * 加入队列时就算好展示信息：队列是「当时的意图」的快照，
   * 之后 jks 改了名字或渠道被删了，这一行也应该还显示当初要打什么包。
   */
  apkName: string
  jksName: string
  status: QueueStatus
  result?: TaskResult
  /** runTask 自己就失败时（还没轮到流水线）的说明，这时没有 result 可看 */
  error?: string
}

const STATUS_LABELS: Record<QueueStatus, string> = {
  pending: '待出包',
  running: '出包中',
  done: '完成',
  failed: '失败',
}

const STATUS_VARIANTS: Record<QueueStatus, 'outline' | 'secondary' | 'destructive'> = {
  pending: 'outline',
  running: 'secondary',
  done: 'outline',
  failed: 'destructive',
}

const SIGN_MODE_LABELS: Record<TaskInput['signMode'], string> = {
  sign: '重签名',
  skip: '跳过签名',
}

/** 一行状态下面那句摘要：失败说原因，成功说产出了几个包 */
function summaryOf(item: QueueItem): string {
  if (item.error) {
    return item.error
  }
  if (item.result) {
    return item.result.message
  }
  return item.status === 'running' ? '正在出包…' : ''
}

interface PackQueueCardProps {
  items: QueueItem[]
  running: boolean
  onStart: () => void
  onClear: () => void
  onRemove: (id: string) => void
  onOpenPath: (target: string, what: string) => void | Promise<void>
}

/**
 * 出包队列：一次提交多组（APK、jks），串行跑完。
 *
 * 逐项结果不铺在页面上（一次十项就会把页面撑得没人愿意往下翻），
 * 而是每行一个「详情」按钮，点开看与单次出包完全一样的结果卡片。
 */
export function PackQueueCard({
  items,
  running,
  onStart,
  onClear,
  onRemove,
  onOpenPath,
}: PackQueueCardProps) {
  const [detailId, setDetailId] = useState<string | null>(null)

  const pendingCount = items.filter((item) => item.status === 'pending').length
  const detailIndex = items.findIndex((item) => item.id === detailId)
  const detail = detailIndex >= 0 ? items[detailIndex] : undefined

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <ListChecks />
          出包队列
          <Badge variant="outline">{items.length} 项</Badge>
        </CardTitle>
        <CardDescription>
          串行执行，一项失败不影响后面的。待出包 {pendingCount} 项。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onStart} disabled={running || pendingCount === 0}>
            <Play />
            {running ? '队列出包中…' : '开始队列'}
          </Button>
          <Button variant="outline" onClick={onClear} disabled={running}>
            <Trash2 />
            清空队列
          </Button>
          <span className="text-xs text-muted-foreground">
            「加入队列」只把当前表单的参数记下来，点「开始队列」才真正出包
          </span>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>APK</TableHead>
                <TableHead>jks</TableHead>
                <TableHead>渠道</TableHead>
                <TableHead>签名</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={item.id}>
                  <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                  <TableCell className="max-w-[16rem] truncate" title={item.params.apkPath}>
                    {item.apkName}
                  </TableCell>
                  <TableCell className="max-w-[12rem] truncate" title={item.jksName}>
                    {item.jksName}
                  </TableCell>
                  <TableCell>{item.params.channelCodes.length} 个</TableCell>
                  <TableCell>{SIGN_MODE_LABELS[item.params.signMode]}</TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant={STATUS_VARIANTS[item.status]}>
                        {STATUS_LABELS[item.status]}
                      </Badge>
                      {summaryOf(item) !== '' ? (
                        <span
                          className="max-w-[18rem] truncate text-xs text-muted-foreground"
                          title={summaryOf(item)}
                        >
                          {summaryOf(item)}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {item.result ? (
                        <Button variant="outline" size="sm" onClick={() => setDetailId(item.id)}>
                          详情
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRemove(item.id)}
                        disabled={running || item.status === 'running'}
                      >
                        <X />
                        移除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog
        open={detail !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setDetailId(null)
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>队列第 {detailIndex + 1} 项的结果</DialogTitle>
          </DialogHeader>
          {detail?.result ? (
            <TaskResultCard
              result={detail.result}
              onOpenPath={onOpenPath}
              heading={`${detail.apkName} · ${detail.result.ok ? '出包完成' : '出包失败'}`}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
