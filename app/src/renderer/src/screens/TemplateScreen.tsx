import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { PairListEditor, newPairRow, type PairRow } from '@/components/PairListEditor'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { findDuplicates } from '@/lib/duplicates'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useAppStore } from '@/store/app-store'

export function TemplateScreen() {
  const { template, saveTemplate } = useAppStore()
  const [rows, setRows] = useState<PairRow[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="渠道模板"
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
          />
        </CardContent>
      </Card>
    </div>
  )
}
