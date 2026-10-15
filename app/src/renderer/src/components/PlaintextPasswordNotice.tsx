import { ShieldAlert } from 'lucide-react'

/**
 * 口令以明文存在 `data/jks.json` 里，和 jks 副本同一目录。
 * 这是刻意的取舍（签名要能一键套用，就不能每次让人重输口令），
 * 但必须让使用者一直看得见，不能藏在帮助文档里。
 */
export function PlaintextPasswordNotice() {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
      <span>密码以明文保存在本地数据目录中，与签名文件同处一个目录。请勿将数据目录整体外发。</span>
    </p>
  )
}
