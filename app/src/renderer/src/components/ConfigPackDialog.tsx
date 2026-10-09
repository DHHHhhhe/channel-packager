import { useEffect, useState } from 'react'
import { CheckCircle2, Info, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
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
  /** 本机模板现有条数，用来算「用包里的 N 条替换本机 M 条」 */
  localTemplateCount: number
  onClose: () => void
  onImported: (result: PackImportResult) => void
}

/**
 * 冲突处理方式。
 *
 * 标签保持一句话，具体后果放在下拉框下面单独一行 ——
 * 把「本机这几份会丢」塞进选项文本里，下拉框会被撑得变形。
 */
const STRATEGY_LABELS: Record<ConflictStrategy, string> = {
  'keep-both': '保留两份（自动加后缀）',
  skip: '跳过冲突项',
  overwrite: '覆盖本机同名条目',
}

const STRATEGY_HINTS: Record<ConflictStrategy, string> = {
  'keep-both': '包内那份会自动改成别的名字，本机现有的原样不动。',
  skip: '本机保持不变，包里这几项不会导入。',
  overwrite: '用包内的替换本机同名条目，本机那几份会被删掉。',
}

function shortHash(value: string): string {
  return value === '' ? '（无）' : value.slice(0, 8)
}

/** 字节数说成能比较的量级；拿不到大小（0）时明说不知道，不显示成「0 B」 */
function formatSize(bytes: number): string {
  if (bytes <= 0) {
    return '大小未知'
  }
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

/** 导入结果的一句话摘要，对话框与页面提示共用 */
export function summarizeImport(result: PackImportResult): string {
  return [
    `新增 ${result.importedJks} 个`,
    result.overwritten > 0 ? `覆盖 ${result.overwritten} 个` : '',
    result.renamed > 0 ? `另存 ${result.renamed} 个` : '',
    result.skipped > 0 ? `跳过 ${result.skipped} 个` : '',
    result.importedTemplate ? '模板已更新' : '模板未变',
  ]
    .filter((entry) => entry !== '')
    .join('，')
}

export function ConfigPackDialog({
  preview,
  localTemplateCount,
  onClose,
  onImported,
}: ConfigPackDialogProps) {
  // 默认「保留两份」：三种策略里唯一不会丢掉任何一方数据的
  const [strategy, setStrategy] = useState<ConflictStrategy>('keep-both')
  const [overwriteTemplate, setOverwriteTemplate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /* 导入成功后的明细：先留在对话框里给用户看完，关掉时才回报给上层 */
  const [result, setResult] = useState<PackImportResult | null>(null)

  useEffect(() => {
    if (preview) {
      setStrategy('keep-both')
      /*
       * 本机模板已经被改过时不默认勾选：包里的模板一覆盖，本机那份就没了，
       * 而用户点「导入配置包」时多半是冲着签名文件与渠道来的，不是模板。
       */
      setOverwriteTemplate(preview.templateDiffers !== true)
      setError('')
      setBusy(false)
      setResult(null)
    }
  }, [preview])

  const conflicts = preview?.conflicts ?? []
  // 不含凭据的包里一个 jks 都没有，「有没有冲突」这句话对它没意义
  const credentialFree = preview?.credentialFree === true
  const incomingTemplateCount = preview?.incomingTemplateCount ?? 0
  const incomingTemplateSample = preview?.incomingTemplateSample ?? []

  const handleApply = async () => {
    if (!preview?.packPath) {
      return
    }
    setBusy(true)
    setError('')
    try {
      const applied = await window.api.applyConfigPack({
        packPath: preview.packPath,
        conflictStrategy: strategy,
        overwriteTemplate,
      })
      setResult(applied)
    } catch (cause) {
      setError(ipcErrorMessage(cause))
      setBusy(false)
    }
  }

  /* 明细看完关掉：这时才把结果交给上层（它会重载数据并写下摘要） */
  const finish = () => {
    if (result) {
      onImported(result)
      return
    }
    onClose()
  }

  return (
    <Dialog open={preview !== null} onOpenChange={(open) => (open ? undefined : finish())}>
      <DialogContent className="max-w-2xl">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>导入完成</DialogTitle>
              <DialogDescription>{summarizeImport(result)}。</DialogDescription>
            </DialogHeader>

            {result.notes.length > 0 ? (
              <div className="flex flex-col gap-2">
                <Label>明细</Label>
                <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border px-3 py-2 text-xs text-muted-foreground">
                  {result.notes.map((note, index) => (
                    <li key={index} className="flex items-start gap-1.5">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">没有需要特别说明的地方。</p>
            )}

            <DialogFooter>
              <Button onClick={finish}>完成</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>导入配置包</DialogTitle>
              <DialogDescription>
                {preview?.credentialFree
                  ? '这是一份不含签名凭据的初始包，只有渠道模板'
                  : `包内 ${preview?.jksCount ?? 0} 个签名文件、${preview?.channelCount ?? 0} 份渠道列表`}
                {preview?.exportedAt
                  ? `，导出于 ${preview.exportedAt.slice(0, 19).replace('T', ' ')}`
                  : ''}
                。校验已通过。
              </DialogDescription>
            </DialogHeader>

            {preview?.credentialFree ? (
              <p className="flex items-start gap-1.5 rounded-md border px-3 py-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  这份包里没有私钥与密码，也没有渠道列表，本机的签名文件与渠道数据不会受到任何影响。
                  导入后新增签名文件即可套用模板。
                </span>
              </p>
            ) : (
              <p className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  配置包内含<strong>明文密码与私钥</strong>
                  。导入等于把对方的签名身份装进本机，请只导入你信任的来源。
                </span>
              </p>
            )}

            {credentialFree ? null : conflicts.length > 0 ? (
              <div className="flex flex-col gap-2">
                <Label>以下 {conflicts.length} 项在本机已存在且内容不同</Label>
                <div className="overflow-hidden rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40%]">条目</TableHead>
                        <TableHead>本机副本</TableHead>
                        <TableHead>包内副本</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {conflicts.map((conflict) => (
                        <TableRow key={conflict.id}>
                          <TableCell>
                            <span className="flex flex-col">
                              <span>{conflict.displayName}</span>
                              <span className="text-xs text-muted-foreground">{conflict.id}</span>
                            </span>
                          </TableCell>
                          <TableCell
                            className="text-xs"
                            title={`SHA256 ${conflict.existingSha256}`}
                          >
                            {formatSize(conflict.existingSize)}
                            <span className="text-muted-foreground">
                              {' '}
                              · {shortHash(conflict.existingSha256)}
                            </span>
                          </TableCell>
                          <TableCell
                            className="text-xs"
                            title={`SHA256 ${conflict.incomingSha256}`}
                          >
                            {formatSize(conflict.incomingSize)}
                            <span className="text-muted-foreground">
                              {' '}
                              · {shortHash(conflict.incomingSha256)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground">
                  比的是两边副本的大小与指纹前 8 位，鼠标停在上面能看完整指纹。
                </p>
                <Select
                  value={strategy}
                  onValueChange={(value) => setStrategy(value as ConflictStrategy)}
                >
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
                <p className="text-xs text-muted-foreground">{STRATEGY_HINTS[strategy]}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                没有冲突：包内条目要么本机没有，要么与本机完全相同。
              </p>
            )}

            {preview?.hasTemplate ? (
              <div className="flex flex-col gap-2">
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={overwriteTemplate}
                    onCheckedChange={(value) => setOverwriteTemplate(value === true)}
                    aria-label="同时导入模板"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span>同时导入模板</span>
                    <span className="text-muted-foreground">
                      {preview.templateDiffers
                        ? `本机模板已被改过（现有 ${localTemplateCount} 条），勾选会用包里的覆盖它`
                        : `本机模板仍是默认值（现有 ${localTemplateCount} 条）`}
                    </span>
                  </span>
                </label>
                {incomingTemplateCount > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    包里这份有 {incomingTemplateCount} 条：
                    {incomingTemplateSample.join('、')}
                    {incomingTemplateCount > incomingTemplateSample.length ? ' …' : ''}。
                    {overwriteTemplate
                      ? `导入后本机现有的 ${localTemplateCount} 条会被替换掉。`
                      : '不勾选的话本机模板不动。'}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    包里这份模板读不出条目，勾选也不会改变本机模板。
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">包内没有模板文件，模板不受影响。</p>
            )}

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={busy}>
                取消
              </Button>
              <Button onClick={handleApply} disabled={busy}>
                {busy ? <Spinner /> : null}
                {busy ? '导入中…' : '确认导入'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
