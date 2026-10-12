import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, FolderOpen, Info, ShieldAlert, Upload } from 'lucide-react'
import { ConfigPackDialog, summarizeImport } from '@/components/ConfigPackDialog'
import { PageHeader } from '@/components/PageHeader'
import { PairListEditor, newPairRow, type PairRow } from '@/components/PairListEditor'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Spinner } from '@/components/ui/spinner'
import type { PackImportResult, PackPreviewResult } from '@shared/types/pack'
import { findDuplicates } from '@/lib/duplicates'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { dirName } from '@/lib/paths'
import { useAppStore } from '@/store/app-store'
import { useSaveShortcut, useUnsavedGuard } from '@/store/nav'

export function TemplateScreen() {
  const { template, saveTemplate, reload, jksItems, groups } = useAppStore()
  const [rows, setRows] = useState<PairRow[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{
    kind: 'ok' | 'error'
    text: string
    /** 导出成功后落在哪个文件上，用来给「打开所在目录」 */
    path?: string
    /** 导入结果的逐条明细，摘要一句话说不清「另存成了什么名字」 */
    notes?: string[]
  } | null>(null)
  const [packPreview, setPackPreview] = useState<PackPreviewResult | null>(null)
  const [packBusy, setPackBusy] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  // 默认带凭据，保持原来的行为；勾上就是给同事的初始包
  const [credentialFree, setCredentialFree] = useState(false)

  // 首次加载与每次保存后用存储里的内容重置草稿
  useEffect(() => {
    setRows(template.suffixes.map((item) => newPairRow(item.suffix, item.alias)))
    setDirty(false)
  }, [template])

  const duplicates = useMemo(() => findDuplicates(rows.map((row) => row.key)), [rows])
  const hasEmpty = rows.some((row) => row.key.trim() === '')

  const handleChange = (next: PairRow[]) => {
    setRows(next)
    setDirty(true)
    setStatus(null)
  }

  const handleSave = useCallback(async () => {
    if (hasEmpty) {
      setStatus({ kind: 'error', text: '后缀不能为空。' })
      return
    }
    if (duplicates.length > 0) {
      setStatus({ kind: 'error', text: `后缀重复：${duplicates.join('、')}。` })
      return
    }
    setSaving(true)
    try {
      await saveTemplate({
        version: 1,
        suffixes: rows.map((row) => ({ suffix: row.key.trim(), alias: row.alias.trim() })),
      })
      setStatus({ kind: 'ok', text: '模板已保存。' })
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    } finally {
      setSaving(false)
    }
  }, [hasEmpty, duplicates, rows, saveTemplate])

  /* Ctrl+S 与页面上的「保存模板」走同一个动作 */
  useSaveShortcut(
    'template',
    useCallback(() => {
      void handleSave()
    }, [handleSave]),
  )

  /* 有没保存的改动时，关窗口会被拦一下（切页不会：页面一直挂着，切回来内容还在） */
  useUnsavedGuard(dirty ? '后缀表的改动' : null)

  /* 导出前的清单：先让人看清包里有什么，再弹系统保存框 */
  const exportSummary = useMemo(() => {
    const jksBytes = jksItems.reduce((total, item) => total + (item.fileSize ?? 0), 0)
    return {
      jksCount: jksItems.length,
      jksNames: jksItems.map((item) => item.displayName),
      jksKb: Math.round(jksBytes / 1024),
      groupCount: groups.length,
      templateCount: template.suffixes.length,
    }
  }, [jksItems, groups, template])

  const runExport = async () => {
    setStatus(null)
    setPackBusy(true)
    try {
      const result = await window.api.exportConfigPack(!credentialFree)
      if (result.canceled) {
        return
      }
      const size = Math.round((result.totalBytes ?? 0) / 1024)
      const suffix = result.credentialFree === true ? '（不含签名凭据）' : ''
      setStatus({
        kind: 'ok',
        text: `已导出配置包${suffix}：${result.path}（${result.fileCount ?? 0} 个文件，${size} KB）`,
        path: result.path ?? undefined,
      })
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    } finally {
      setPackBusy(false)
    }
  }

  const handlePickPack = async () => {
    setStatus(null)
    setPackBusy(true)
    try {
      const preview = await window.api.pickConfigPack()
      if (preview.canceled) {
        return
      }
      setPackPreview(preview)
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    } finally {
      setPackBusy(false)
    }
  }

  const handleImported = async (result: PackImportResult) => {
    setPackPreview(null)
    /* 摘要只留一句话，逐条明细（尤其是「另存成了什么名字」）挂在下面单独列 */
    setStatus({ kind: 'ok', text: `导入完成：${summarizeImport(result)}。`, notes: result.notes })
    // 导入会同时改 jks 与模板，整份重载，界面立刻反映新数据
    await reload()
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        description="新增签名文件时套用的后缀表，模板独立于签名文件。右上角的「保存模板」保存的是下面的后缀表；配置包的导入导出点完立即生效。"
        actions={
          <>
            {dirty ? <span className="text-xs text-muted-foreground">有未保存的修改</span> : null}
            <Button onClick={handleSave} disabled={saving || !dirty}>
              {saving ? <Spinner /> : null}
              {saving ? '保存中…' : '保存模板'}
            </Button>
          </>
        }
      />

      {status ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={
                status.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-success'
              }
              role={status.kind === 'error' ? 'alert' : 'status'}
            >
              {status.text}
            </p>
            {status.path ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void window.api.openPath(dirName(status.path ?? ''))
                }}
              >
                <FolderOpen />
                打开所在目录
              </Button>
            ) : null}
          </div>
          {status.notes && status.notes.length > 0 ? (
            <ul className="flex flex-col gap-1 rounded-md border px-3 py-2 text-xs text-muted-foreground">
              {status.notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>后缀表</CardTitle>
          <CardDescription>
            套用时按 <code>渠道名 = 前缀 + &quot;_&quot; + 后缀</code> 生成，前缀为空则直接用后缀。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PairListEditor
            rows={rows}
            onChange={handleChange}
            keyLabel="后缀"
            keyPlaceholder="例如 gf"
            aliasPlaceholder="例如 官方"
            emptyHint="模板为空。新增签名文件时勾选套用模板将得到空渠道列表。"
            selectable
            filterable
            duplicates={duplicates}
            bulkPaste
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>配置包</CardTitle>
          <CardDescription>
            把整套配置（签名文件副本、凭据、渠道列表、模板）打成一个 zip，便于换机器导入后直接出包。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setStatus(null)
                setExportOpen(true)
              }}
              disabled={packBusy}
            >
              <Download />
              导出配置包
            </Button>
            <Button variant="outline" onClick={handlePickPack} disabled={packBusy}>
              <Upload />
              导入配置包
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="pack-credential-free"
              checked={credentialFree}
              onCheckedChange={(checked) => setCredentialFree(checked === true)}
              disabled={packBusy}
            />
            <Label htmlFor="pack-credential-free" className="text-sm font-normal">
              导出时不带签名凭据（只给渠道模板，签名文件由对方自行补充）
            </Label>
          </div>
          {credentialFree ? (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                这份包里只有渠道模板，没有私钥、密码，也没有分组与渠道列表。适合发给同事作为初始配置，对方导入后自行新增
                签名文件并套用模板。
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                配置包内含<strong>明文密码与私钥</strong>。导出后只发给你信任的人；导入等于把对方的签名身份装进本机。
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={exportOpen}
        onOpenChange={(open) => {
          if (!open) {
            setExportOpen(false)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>导出配置包</DialogTitle>
            <DialogDescription>
              打包后是一个 zip，换机器导入就能直接出包。确认后才会弹出保存位置。
            </DialogDescription>
          </DialogHeader>

          <ul className="flex flex-col gap-1.5 text-sm">
            {credentialFree ? (
              <li className="text-muted-foreground">
                不含签名凭据：包里只有模板（{exportSummary.templateCount} 条后缀），签名文件、渠道列表与分组都不带。
              </li>
            ) : (
              <>
                <li>
                  签名文件：{exportSummary.jksCount} 个
                  {exportSummary.jksCount > 0 ? `（${exportSummary.jksNames.join('、')}）` : ''}
                  ，副本合计约 {exportSummary.jksKb} KB
                </li>
                <li>渠道列表：{exportSummary.groupCount} 份</li>
                <li>模板：{exportSummary.templateCount} 条后缀</li>
              </>
            )}
          </ul>

          {credentialFree ? (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>适合发给同事作为初始配置，对方导入后自行新增签名文件并套用模板。</span>
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                包里含<strong>明文密码与私钥</strong>。导出后只发给你信任的人。
              </span>
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                setExportOpen(false)
                void runExport()
              }}
            >
              选择保存位置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfigPackDialog
        preview={packPreview}
        localTemplateCount={template.suffixes.length}
        onClose={() => setPackPreview(null)}
        onImported={handleImported}
      />
    </div>
  )
}
