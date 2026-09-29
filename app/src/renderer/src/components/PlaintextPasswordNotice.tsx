import { ShieldAlert } from 'lucide-react'

/**
 * 口令以明文存在 `data/jks.json` 里，和 jks 副本同一目录。
 * 这是刻意的取舍（便携、可整目录搬迁），但必须让使用者一直看得见，不能藏在帮助文档里。
 */
export function PlaintextPasswordNotice() {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
      <span>口令以明文保存在 data/jks.json，与 jks 副本同目录。请勿把 data 目录外发。</span>
    </p>
  )
}
