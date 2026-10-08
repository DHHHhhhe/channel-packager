import { useEffect, useMemo, useState } from 'react'
import { Download, ShieldAlert, Upload } from 'lucide-react'
import { ConfigPackDialog } from '@/components/ConfigPackDialog'
import { PageHeader } from '@/components/PageHeader'
import { PairListEditor, newPairRow, type PairRow } from '@/components/PairListEditor'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { PackImportResult, PackPreviewResult } from '@shared/types/pack'
import { findDuplicates } from '@/lib/duplicates'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useAppStore } from '@/store/app-store'

export function TemplateScreen() {
  const { template, saveTemplate, reload } = useAppStore()
  const [rows, setRows] = useState<PairRow[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [packPreview, setPackPreview] = useState<PackPreviewResult | null>(null)
  const [packBusy, setPackBusy] = useState(false)

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

  const handleSave = async () => {
    if (hasEmpty) {
      setStatus({ kind: 'error', text: '后缀不能为空。' })
      return
    }
    if (duplicates.length > 0) {
      setStatus({ kind: 'error', text: `后缀重复：${duplicates.join('、')}` })
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
  }

  const handleExportPack = async () => {
    setStatus(null)
    setPackBusy(true)
    try {
      const result = await window.api.exportConfigPack()
      if (result.canceled) {
        return
      }
      const size = Math.round((result.totalBytes ?? 0) / 1024)
      setStatus({
        kind: 'ok',
        text: `已导出配置包：${result.path}（${result.fileCount ?? 0} 个文件，${size} KB）`,
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
    const parts = [
      `新增 ${result.importedJks} 个`,
      result.overwritten > 0 ? `覆盖 ${result.overwritten} 个` : '',
      result.renamed > 0 ? `另存 ${result.renamed} 个` : '',
      result.skipped > 0 ? `跳过 ${result.skipped} 个` : '',
      result.importedTemplate ? '模板已更新' : '模板未变',
    ].filter((entry) => entry !== '')
    setStatus({
      kind: 'ok',
      text: `导入完成：${parts.join('，')}。${result.notes.join(' ')}`,
    })
    // 导入会同时改 jks 与模板，整份重载，界面立刻反映新数据
    await reload()
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        description="新增 jks 时套用的渠道后缀表。模板独立于任何 jks，改它不会动到已有副本。"
        actions={
          <>
            {dirty ? <span className="text-xs text-muted-foreground">有未保存的修改</span> : null}
            <Button onClick={handleSave} disabled={saving || !dirty}>
              {saving ? '保存中…' : '保存模板'}
            </Button>
          </>
        }
      />

      {status ? (
        <p className={status.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
          {status.text}
        </p>
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
            emptyHint="模板为空。新增 jks 时勾选套用模板将得到空渠道列表。"
            selectable
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>配置包</CardTitle>
          <CardDescription>
            把整套配置（jks 副本、凭据、渠道列表、模板）打成一个 zip；换台机器导入即可直接出包。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={handleExportPack} disabled={packBusy}>
              <Download />
              导出配置包
            </Button>
            <Button variant="outline" onClick={handlePickPack} disabled={packBusy}>
              <Upload />
              导入配置包
            </Button>
          </div>
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              配置包内含<strong>明文密码与私钥</strong>。导出后只发给你信任的人；导入等于把对方的签名身份装进本机。
            </span>
          </p>
        </CardContent>
      </Card>

      <ConfigPackDialog
        preview={packPreview}
        onClose={() => setPackPreview(null)}
        onImported={handleImported}
      />
    </div>
  )
}
