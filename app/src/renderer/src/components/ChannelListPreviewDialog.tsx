import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { ChannelImportMode, ChannelListPreview } from '../../../shared/types/pack'

interface ChannelListPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 对话框标题，如「导入渠道 JSON」 */
  title: string
  /** 主进程只读解析出来的结果；null 表示还没读到内容 */
  preview: ChannelListPreview | null
  /** 当前界面上的条数，用来提示会变成多少条 */
  currentCount: number
  /** 当前列表有未保存的修改，导入会丢弃它们 */
  dirty: boolean
  busy: boolean
  /** 对现有列表的处理方式，默认覆盖 */
  mode: ChannelImportMode
  onModeChange: (mode: ChannelImportMode) => void
  onConfirm: () => void
}

/**
 * 「导入前先看一眼」的确认框。
 *
 * 导入会直接改写文件，选错文件或选错处理方式都要付出代价，所以这里做三件事：
 * 把将要写入的条目逐条列出来、让用户明确选「覆盖」还是「追加」、点确认才落盘。
 */
export function ChannelListPreviewDialog({
  open,
  onOpenChange,
  title,
  preview,
  currentCount,
  dirty,
  busy,
  mode,
  onModeChange,
  onConfirm,
}: ChannelListPreviewDialogProps): React.JSX.Element {
  const count = preview?.count ?? 0
  const overwrite = mode === 'overwrite'
  // 追加是按渠道名去重的，实际新增多少条要等主进程算，这里只给上界
  const clearing = overwrite && count === 0 && currentCount > 0

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onOpenChange(false))}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {preview
              ? `从「${preview.fileName}」读到 ${count} 条渠道。${
                  overwrite ? '确认后会整表替换当前列表。' : '确认后与当前列表合并，同名渠道不重复。'
                }`
              : '还没有读到内容。'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm text-muted-foreground">对现有 {currentCount} 条渠道</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={overwrite ? 'default' : 'outline'}
              aria-pressed={overwrite}
              disabled={busy}
              onClick={() => onModeChange('overwrite')}
            >
              覆盖
            </Button>
            <Button
              type="button"
              size="sm"
              variant={overwrite ? 'outline' : 'default'}
              aria-pressed={!overwrite}
              disabled={busy}
              onClick={() => onModeChange('append')}
            >
              追加
            </Button>
            <span className="text-sm text-muted-foreground">
              {overwrite ? '清空后只保留文件里的条目' : '保留现有条目，只补文件里多出来的'}
            </span>
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="text-muted-foreground">当前</span>
            <span className="font-medium tabular-nums">{currentCount}</span>
            <span className="text-muted-foreground">条</span>
            <span className="text-muted-foreground">→</span>
            <span className="text-muted-foreground">导入后</span>
            <span className="font-medium tabular-nums">
              {overwrite ? count : `最多 ${currentCount + count}`}
            </span>
            <span className="text-muted-foreground">条</span>
          </p>
        </div>

        {clearing ? (
          <p className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>文件里一条渠道都没有，覆盖会把当前 {currentCount} 条全部清空。</span>
          </p>
        ) : null}

        {dirty ? (
          <p className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>当前列表有未保存的修改，导入会丢弃它们（导入结果会直接写入文件）。</span>
          </p>
        ) : null}

        {preview && preview.notes.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {preview.notes.map((note) => (
              <li key={note}>· {note}</li>
            ))}
          </ul>
        ) : null}

        {count > 0 ? (
          <div className="max-h-72 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-right">#</TableHead>
                  <TableHead>渠道名</TableHead>
                  <TableHead>别名</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview?.channels.map((entry, index) => (
                  <TableRow key={`${entry.channel}-${index}`}>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      {index + 1}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{entry.channel}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.alias ?? ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={busy || preview === null}>
            {busy ? '导入中…' : overwrite ? '覆盖导入' : '追加导入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
