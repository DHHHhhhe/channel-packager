import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/**
 * 「复制诊断信息」。
 *
 * 主进程在写剪贴板前会把家目录换成 `%USERPROFILE%`，所以复制出来的东西可以直接
 * 发给别人，不必再手工把本机路径抹掉。
 */
export function CopyDiagnosticsButton({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className={className}
      onClick={() => {
        void window.api
          .writeClipboard(text)
          .then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => {
            toast.error('复制失败，请手动选中文字')
          })
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? '已复制' : '复制诊断信息'}
    </Button>
  )
}
