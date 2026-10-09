import { useEffect, useMemo, useState } from 'react'
import { FileDown, Wand2 } from 'lucide-react'
import { ChannelListPreviewDialog } from '@/components/ChannelListPreviewDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageHeader } from '@/components/PageHeader'
import { PairListEditor, newPairRow, type PairRow } from '@/components/PairListEditor'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ChannelEntry } from '@shared/types/store'
import type { ChannelImportMode, ChannelListPreview } from '@shared/types/pack'
import { buildChannelsFromTemplate } from '@shared/utils/channels'
import { mergeImportedRows } from '@/lib/channels-import'
import { findDuplicates } from '@/lib/duplicates'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useAppStore } from '@/store/app-store'

/** 编辑器里的行 → 落盘/导出用的条目；别名为空时不写这个字段 */
function toChannelEntries(rows: PairRow[]): ChannelEntry[] {
  return rows.map((row) => {
    const alias = row.alias.trim()
    return alias ? { channel: row.key.trim(), alias } : { channel: row.key.trim() }
  })
}

export function ChannelsScreen() {
  const { jksItems, template, getChannels, saveChannels } = useAppStore()
  const [selectedId, setSelectedId] = useState('')
  const [rows, setRows] = useState<PairRow[]>([])
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [prefix, setPrefix] = useState('')
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  /** 已解析待确认的导入；null 表示没有待确认的导入 */
  const [pending, setPending] = useState<ChannelListPreview | null>(null)
  /** 预览框里选的覆盖/追加，默认覆盖 */
  const [importMode, setImportMode] = useState<ChannelImportMode>('overwrite')
  /** 「按模板生成」会整表替换，有未保存改动时先问一声 */
  const [confirmTemplate, setConfirmTemplate] = useState(false)

  const selected = jksItems.find((item) => item.id === selectedId)

  useEffect(() => {
    if (jksItems.length === 0) {
      setSelectedId('')
      return
    }
    if (!jksItems.some((item) => item.id === selectedId)) {
      setSelectedId(jksItems[0].id)
    }
  }, [jksItems, selectedId])

  useEffect(() => {
    if (!selectedId) {
      setRows([])
      return
    }
    let cancelled = false
    setLoading(true)
    setStatus(null)
    // 换 jks 后旧的导入确认框已经没意义了
    setPending(null)
    getChannels(selectedId)
      .then((config) => {
        if (cancelled) {
          return
        }
        setRows(
          config.channelInfoList.map((entry) => newPairRow(entry.channel, entry.alias ?? '')),
        )
        setDirty(false)
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus({ kind: 'error', text: ipcErrorMessage(error) })
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, getChannels])

  // 前缀默认取 jks 基名（即 id），可直接改
  useEffect(() => {
    setPrefix(selectedId)
  }, [selectedId])

  const duplicates = useMemo(() => findDuplicates(rows.map((row) => row.key)), [rows])
  const hasEmpty = rows.some((row) => row.key.trim() === '')

  const handleChange = (next: PairRow[]) => {
    setRows(next)
    setDirty(true)
    setStatus(null)
  }

  const applyTemplate = () => {
    if (!selected) {
      return
    }
    const config = buildChannelsFromTemplate(template.suffixes, prefix, selected.app)
    setRows(config.channelInfoList.map((entry) => newPairRow(entry.channel, entry.alias ?? '')))
    setDirty(true)
    setStatus({
      kind: 'ok',
      text: `已按模板生成 ${config.channelInfoList.length} 条，尚未保存。`,
    })
  }

  /*
   * 按模板生成是整表替换。列表里还有没保存的改动时先问一声 ——
   * 那些改动只存在界面上，换掉就没了。
   */
  const handleApplyTemplateClick = () => {
    if (rows.length > 0 && dirty) {
      setConfirmTemplate(true)
      return
    }
    applyTemplate()
  }

  const handleExportJson = async () => {
    if (!selected) {
      return
    }
    setStatus(null)
    try {
      // 导的是界面上的列表，不是磁盘上那份 —— 刚导入还没保存时也能拿到看到的内容
      const result = await window.api.exportChannels(
        selected.id,
        selected.app,
        toChannelEntries(rows),
      )
      if (result.canceled) {
        return
      }
      setStatus({
        kind: 'ok',
        text: `已导出 ${result.count ?? 0} 条渠道：${result.path}${
          dirty ? '（含尚未保存的修改）' : ''
        }，可直接给 walle 的 batch2 -f 用。`,
      })
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    }
  }

  /*
   * 导入只做「选文件 + 解析」：把文件里的条目拿回来，用户改完、选好覆盖还是追加、
   * 点确认后填进界面列表。**不写文件** —— 导入结果和手工敲进去的没区别，
   * 都要再点「保存渠道列表」才落盘，所以也不需要为「有未保存的修改」报警告。
   */
  const handleImportJson = async () => {
    if (!selected) {
      return
    }
    setStatus(null)
    try {
      const result = await window.api.previewChannels(selected.app)
      if (result === null) {
        return
      }
      setImportMode('overwrite')
      setPending(result)
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    }
  }

  /*
   * 导出一份示例渠道 JSON。只在列表为空时可用 ——
   * 有内容时用户该做的是「导出 JSON」把现有数据拿走，示例文件只会添乱。
   */
  const handleExportSampleJson = async () => {
    if (!selected) {
      return
    }
    setStatus(null)
    try {
      const result = await window.api.exportSampleChannels(selected.id, selected.app, prefix)
      if (result.canceled) {
        return
      }
      setStatus({
        kind: 'ok',
        text: `已导出示例 ${result.count ?? 0} 条：${result.path}${
          result.fromTemplate ? '（条目取自「渠道模板」页的模板）' : '（模板为空，用的是内置兜底示例）'
        }。改好后用「导入 JSON」读回来。`,
      })
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    }
  }

  /** 预览框里点确认：把改过的条目合并进界面列表，等用户点保存才落盘 */
  const handleConfirmImport = (imported: PairRow[]) => {
    const before = rows.length
    const merged = mergeImportedRows(rows, imported, importMode)
    setRows(merged.rows)
    setDirty(true)
    setPending(null)
    const detail =
      importMode === 'overwrite'
        ? `已按文件填入 ${merged.rows.length} 条，替换掉原来的 ${before} 条。`
        : `已追加 ${merged.added} 条（跳过重名 ${merged.skipped} 条），现共 ${merged.rows.length} 条。`
    setStatus({ kind: 'ok', text: `${detail}尚未保存，确认无误后点「保存渠道列表」。` })
  }

  const handleSave = async () => {
    if (!selected) {
      return
    }
    if (hasEmpty) {
      setStatus({ kind: 'error', text: '渠道名不能为空。' })
      return
    }
    if (duplicates.length > 0) {
      setStatus({ kind: 'error', text: `渠道名重复：${duplicates.join('、')}` })
      return
    }
    setSaving(true)
    try {
      await saveChannels(selected.id, {
        defaultExtraInfo: { app: selected.app },
        channelInfoList: toChannelEntries(rows),
      })
      setDirty(false)
      setStatus({ kind: 'ok', text: '渠道列表已保存。' })
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  if (jksItems.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader description="每个 jks 各自维护一份渠道列表。" />
        <Card>
          <CardHeader>
            <CardTitle>还没有 jks</CardTitle>
            <CardDescription>渠道列表挂在 jks 上，请先到「签名配置」新增一个 jks。</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        description="每个 jks 各自维护一份渠道列表，导出后可直接给 walle 的 batch2 -f 使用。"
        actions={
          <>
            {dirty ? <span className="text-xs text-muted-foreground">有未保存的修改</span> : null}
            <Button variant="outline" onClick={handleImportJson} disabled={saving || loading}>
              导入 JSON
            </Button>
            <Button
              variant="outline"
              onClick={handleExportJson}
              disabled={saving || loading || rows.length === 0}
              title={
                rows.length === 0
                  ? '渠道列表为空，没有可导出的内容'
                  : '导出界面上的渠道列表（含尚未保存的修改）'
              }
            >
              导出 JSON
            </Button>
            <Button onClick={handleSave} disabled={saving || loading || !dirty}>
              {saving ? '保存中…' : '保存渠道列表'}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>选择 jks</CardTitle>
          <CardDescription>
            {selected ? `应用名 defaultExtraInfo.app = ${selected.app}` : '请选择一个 jks'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="max-w-sm">
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger aria-label="选择 jks">
                <SelectValue placeholder="请选择 jks" />
              </SelectTrigger>
              <SelectContent>
                {jksItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.displayName}（{item.id}）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="channel-prefix">渠道前缀</Label>
              <Input
                id="channel-prefix"
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
                placeholder="留空则渠道名等于后缀"
                className="w-64"
              />
            </div>
            <Button variant="outline" onClick={handleApplyTemplateClick}>
              <Wand2 />
              按模板生成
            </Button>
            <Button
              variant="outline"
              onClick={handleExportSampleJson}
              disabled={saving || loading || rows.length > 0}
              title={
                rows.length > 0
                  ? '列表里已经有渠道了，要拿走现有内容请用右上角的「导出 JSON」'
                  : '导出一份可编辑的示例 JSON'
              }
            >
              <FileDown />
              导出示例 JSON
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            生成规则：渠道名 = 前缀 + &quot;_&quot; + 后缀。生成的是独立副本，之后再改模板也不会影响这里。
            列表里还有没保存的改动时，会先问一声再覆盖。
          </p>
          <p className="text-xs text-muted-foreground">
            「导出示例 JSON」只在渠道列表为空时可用，导出的是一份可编辑的起点（条目取自「渠道模板」页的模板）；
            改好后用右上角的「导入 JSON」读回来。
          </p>
          <p className="text-xs text-muted-foreground">
            「导入 JSON」会把文件里的条目读进一个预览框，可以在里面直接增删改；确认后只填进下面的列表，
            点「保存渠道列表」才落盘。
          </p>
        </CardContent>
      </Card>

      {status ? (
        <p
          className={
            status.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
          }
        >
          {status.text}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>渠道列表</CardTitle>
          <CardDescription>
            渠道必填、别名选填。共 {rows.length} 条{loading ? '（读取中…）' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PairListEditor
            rows={rows}
            onChange={handleChange}
            keyLabel="渠道名"
            keyPlaceholder="例如 sample_gf"
            aliasPlaceholder="例如 官方"
            emptyHint="还没有渠道条目。可手工添加，或用上面的「按模板生成」。"
            selectable
          />
        </CardContent>
      </Card>

      <ChannelListPreviewDialog
        open={pending !== null}
        onOpenChange={(open) => (open ? undefined : setPending(null))}
        title="导入渠道 JSON"
        preview={pending}
        currentCount={rows.length}
        mode={importMode}
        onModeChange={setImportMode}
        onConfirm={handleConfirmImport}
      />

      <ConfirmDialog
        open={confirmTemplate}
        onOpenChange={setConfirmTemplate}
        title="按模板生成？"
        description={`会按当前前缀「${prefix.trim() || '（空）'}」重算一份列表，替换掉下面现有的 ${rows.length} 条。`}
        warning="这份列表里有还没保存的改动，覆盖后就没了。"
        confirmText="覆盖生成"
        onConfirm={() => {
          setConfirmTemplate(false)
          applyTemplate()
        }}
      />
    </div>
  )
}
