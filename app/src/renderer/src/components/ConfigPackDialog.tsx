import { useEffect, useState } from 'react'
import { Info, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ConflictStrategy, PackImportResult, PackPreviewResult } from '@shared/types/pack'
import { ipcErrorMessage } from '@/lib/ipc-error'

interface ConfigPackDialogProps {
  /** null 表示不显示 */
  preview: PackPreviewResult | null
  onClose: () => void
  onImported: (result: PackImportResult) => void
}

const STRATEGY_LABELS: Record<ConflictStrategy, string> = {
  'keep-both': '保留两份（自动加后缀）',
  skip: '跳过冲突项',
  overwrite: '覆盖本机同 id 条目',
}

function shortHash(value: string): string {
  return value === '' ? '（无）' : value.slice(0, 8)
}

export function ConfigPackDialog({ preview, onClose, onImported }: ConfigPackDialogProps) {
  // 默认「保留两份」：三种策略里唯一不会丢掉任何一方数据的
  const [strategy, setStrategy] = useState<ConflictStrategy>('keep-both')
  const [overwriteTemplate, setOverwriteTemplate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (preview) {
      setStrategy('keep-both')
      setOverwriteTemplate(true)
      setError('')
      setBusy(false)
    }
  }, [preview])

  const conflicts = preview?.conflicts ?? []
  // 不含凭据的包里一个 jks 都没有，「有没有冲突」这句话对它没意义
  const credentialFree = preview?.credentialFree === true

  const handleApply = async () => {
    if (!preview?.packPath) {
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await window.api.applyConfigPack({
        packPath: preview.packPath,
        conflictStrategy: strategy,
        overwriteTemplate,
      })
      onImported(result)
    } catch (cause) {
      setError(ipcErrorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog open={preview !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>导入配置包</DialogTitle>
          <DialogDescription>
            {preview?.credentialFree
              ? '这是一份不含签名凭据的初始包，只有渠道模板'
              : `包内 ${preview?.jksCount ?? 0} 个 jks、${preview?.channelCount ?? 0} 份渠道文件`}
            {preview?.exportedAt ? `，导出于 ${preview.exportedAt.slice(0, 19).replace('T', ' ')}` : ''}。
            校验已通过。
          </DialogDescription>
        </DialogHeader>

        {preview?.credentialFree ? (
          <p className="flex items-start gap-1.5 rounded-md border px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              这份包里没有私钥、密码，也没有渠道列表，本机的 jks 与渠道数据一条都不会被动到。
              导入后自己新增 jks 即可套用模板。
            </span>
          </p>
        ) : (
          <p className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              配置包内含<strong>明文密码与私钥</strong>。导入等于把对方的签名身份装进本机，请只导入你信任的来源。
            </span>
          </p>
        )}

        {credentialFree ? null : conflicts.length > 0 ? (
          <div className="flex flex-col gap-2">
            <Label>以下 {conflicts.length} 个 id 在本机已存在且内容不同</Label>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>id</TableHead>
                    <TableHead>本机 SHA256</TableHead>
                    <TableHead>包内 SHA256</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conflicts.map((conflict) => (
                    <TableRow key={conflict.id}>
                      <TableCell>{conflict.id}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {shortHash(conflict.existingSha256)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {shortHash(conflict.incomingSha256)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Select value={strategy} onValueChange={(value) => setStrategy(value as ConflictStrategy)}>
              <SelectTrigger aria-label="冲突处理方式">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STRATEGY_LABELS) as ConflictStrategy[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {STRATEGY_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            没有冲突：包内条目要么本机没有，要么与本机完全相同。
          </p>
        )}

        {preview?.hasTemplate ? (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={overwriteTemplate}
              onCheckedChange={(value) => setOverwriteTemplate(value === true)}
              aria-label="同时导入模板"
            />
            <span>
              同时导入模板
              <span className="text-muted-foreground">
                {preview.templateDiffers
                  ? '（本机模板已被改过，勾选会用包里的覆盖它）'
                  : '（本机模板仍是默认值）'}
              </span>
            </span>
          </label>
        ) : (
          <p className="text-sm text-muted-foreground">包内没有 template.json，模板不受影响。</p>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={handleApply} disabled={busy}>
            {busy ? '导入中…' : '确认导入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
