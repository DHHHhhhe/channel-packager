import { useState } from 'react'
import { ArrowDown, ArrowUp, ListChecks, Play, RotateCcw, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
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
  /** 渠道来自哪个分组；自定义渠道出包时是空串 */
  groupName: string
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

/*
 * 待出包留中性、进行中走 info、完成走 success、失败走 destructive。
 * 原来 done 与 pending 都是 outline，扫一眼分不出跑没跑过。
 */
const STATUS_VARIANTS: Record<QueueStatus, 'outline' | 'info' | 'success' | 'destructive'> = {
  pending: 'outline',
  running: 'info',
  done: 'success',
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
  // 进行中不另写一句「正在出包…」—— 状态徽标已经说了，重复一遍只是噪音
  return ''
}

interface PackQueueCardProps {
  items: QueueItem[]
  running: boolean
  onStart: () => void
  onClear: () => void
  onRemove: (id: string) => void
  /** 把一项退回「待出包」，让它跟着队列再跑一次 */
  onRetry: (id: string) => void
  /** 把所有失败项一起退回「待出包」 */
  onRetryFailed: () => void
  /** 调整执行顺序：direction 为 -1 上移、1 下移 */
  onMove: (id: string, direction: -1 | 1) => void
  /** 把这一项的参数填回上面的表单（不立刻开跑） */
  onRerun: (item: QueueItem) => void
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
  onRetry,
  onRetryFailed,
  onMove,
  onRerun,
  onOpenPath,
}: PackQueueCardProps) {
  const [detailId, setDetailId] = useState<string | null>(null)

  const pendingCount = items.filter((item) => item.status === 'pending').length
  const failedCount = items.filter((item) => item.status === 'failed').length
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
          按下面的顺序从上往下一项接一项执行，某一项失败不会影响后面的。待出包 {pendingCount} 项
          {failedCount > 0 ? `，失败 ${failedCount} 项` : ''}。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onStart} disabled={running || pendingCount === 0}>
            {running ? <Spinner /> : <Play />}
            {running ? '正在出包…' : '开始队列'}
          </Button>
          {/*
            失败项原来只能「移除」再重新加一遍 —— 参数明明还在这一行上，
            却要回表单里重挑一遍 APK 和分组。
          */}
          {failedCount > 0 ? (
            <Button variant="outline" onClick={onRetryFailed} disabled={running}>
              <RotateCcw />
              重跑失败项（{failedCount}）
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClear} disabled={running || items.length === 0}>
            <Trash2 />
            清空队列
          </Button>
          <span className="text-xs text-muted-foreground">
            「加入队列」只把当前表单的参数记下来，点「开始队列」才真正出包。
          </span>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24" title="从上往下依次执行，可以调整顺序">
                  顺序
                </TableHead>
                <TableHead>APK</TableHead>
                <TableHead>签名文件</TableHead>
                <TableHead>渠道分组</TableHead>
                <TableHead>签名</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="flex items-center gap-0.5">
                      <span className="w-5 text-muted-foreground">{index + 1}</span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onMove(item.id, -1)}
                        disabled={running || index === 0}
                        title="上移一位（提前出包）"
                        aria-label={`把第 ${index + 1} 项上移`}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onMove(item.id, 1)}
                        disabled={running || index === items.length - 1}
                        title="下移一位（推后出包）"
                        aria-label={`把第 ${index + 1} 项下移`}
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[16rem] truncate" title={item.params.apkPath}>
                    {item.apkName}
                  </TableCell>
                  <TableCell className="max-w-[12rem] truncate" title={item.jksName}>
                    {item.jksName}
                  </TableCell>
                  <TableCell className="max-w-[14rem] truncate" title={item.groupName}>
                    {item.groupName !== '' ? item.groupName : '自定义'} ·{' '}
                    {item.params.channelCodes.length} 个渠道
                  </TableCell>
                  <TableCell>{SIGN_MODE_LABELS[item.params.signMode]}</TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant={STATUS_VARIANTS[item.status]}>
                        {item.status === 'running' ? <Spinner /> : null}
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
                      {item.status === 'failed' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onRetry(item.id)}
                          disabled={running}
                          title="把这一项退回「待出包」，参数不用重新填"
                        >
                          <RotateCcw />
                          重跑
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
              onRerun={() => {
                // 填回表单后把详情收起来，不然人还停在结果上看不见表单变了
                setDetailId(null)
                onRerun(detail)
              }}
              rerunDisabled={running}
              heading={`${detail.apkName} · ${detail.result.ok ? '出包完成' : '出包失败'}`}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
