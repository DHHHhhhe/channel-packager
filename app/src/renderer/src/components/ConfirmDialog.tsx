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

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** 一句话说清点下去会发生什么 */
  description: string
  /** 可选：会丢掉什么。有内容时按警示样式显示 */
  warning?: string
  confirmText?: string
  cancelText?: string
  /** 确认按钮用危险色（默认 false） */
  destructive?: boolean
  onConfirm: () => void
}

/**
 * 一问一答的确认框。
 *
 * 只用来拦「点下去会覆盖掉用户手里东西」的动作 —— 这类动作的共同点是
 * 没有撤销，弹一次比让人事后发现少了几条渠道便宜得多。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  warning,
  confirmText = '继续',
  cancelText = '取消',
  destructive = false,
  onConfirm,
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onOpenChange(false))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {warning ? (
          <p className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>{warning}</span>
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelText}
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
