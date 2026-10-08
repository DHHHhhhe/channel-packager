import { useEffect, useMemo, useState } from 'react'
import { FileDown, FileUp, Wand2 } from 'lucide-react'
import { ChannelListPreviewDialog } from '@/components/ChannelListPreviewDialog'
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
import type { ChannelListPreview } from '@shared/types/pack'
import { buildChannelsFromTemplate } from '@shared/utils/channels'
import { findDuplicates } from '@/lib/duplicates'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useAppStore } from '@/store/app-store'

/** 待确认的导入：渠道 JSON 与模板 JSON 走同一个确认框，只是落盘那一步不同 */
type PendingImport = { kind: 'channels' | 'template'; preview: ChannelListPreview }

export function ChannelsScreen() {
  const { jksItems, template, getChannels, saveChannels } = useAppStore()
  const [selectedId, setSelectedId] = useState('')
  const [rows, setRows] = useState<PairRow[]>([])
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [prefix, setPrefix] = useState('')
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [importing, setImporting] = useState(false)

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

  const handleExportJson = async () => {
    if (!selected) {
      return
    }
    setStatus(null)
    try {
      const result = await window.api.exportChannels(selected.id, selected.app)
      if (result.canceled) {
        return
      }
      setStatus({
        kind: 'ok',
        text: `已导出 ${result.count ?? 0} 条渠道：${result.path}（可直接给 walle 的 batch2 -f 用）`,
      })
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    }
  }

  /*
   * 导入分两步：先让主进程只读解析、把将要写入的条目拿回来，
   * 用户看过确认框点「确认导入」才落盘 —— 渠道列表是整表替换，选错文件代价大。
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
      setPending({ kind: 'channels', preview: result })
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    }
  }

  /*
   * 导出的是「模板后缀表」本身，不是当前渠道列表 ——
   * 给用户一份短小、好改的起点，改完由 handleImportTemplateJson 展开成渠道名。
   */
  const handleExportTemplateJson = async () => {
    if (!selected) {
      return
    }
    setStatus(null)
    try {
      const result = await window.api.exportTemplateJson()
      if (result.canceled) {
        return
      }
      setStatus({
        kind: 'ok',
        text: `已导出模板 ${result.count ?? 0} 条后缀：${result.path}（改完用「导入模板 JSON」套用到当前 jks）${
          result.isDefault ? '；当前就是内置默认模板' : ''
        }`,
      })
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    }
  }

  const handleImportTemplateJson = async () => {
    if (!selected) {
      return
    }
    setStatus(null)
    try {
      const result = await window.api.previewTemplateJson(selected.app, prefix)
      if (result === null) {
        return
      }
      setPending({ kind: 'template', preview: result })
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    }
  }

  /** 确认框里点「确认导入」：这时才真正写文件 */
  const handleConfirmImport = async () => {
    if (!selected || pending === null) {
      return
    }
    const { kind, preview } = pending
    setImporting(true)
    try {
      const result =
        kind === 'channels'
          ? await window.api.applyChannels(selected.id, selected.app, preview.path)
          : await window.api.applyTemplateJson(selected.id, selected.app, prefix, preview.path)
      // 渠道 JSON 是原样复制，模板 JSON 是按前缀展开，两者都已经在 result 里算好了
      setRows(
        result.config.channelInfoList.map((entry) => newPairRow(entry.channel, entry.alias ?? '')),
      )
      setDirty(false)
      setPending(null)
      const shown = prefix.trim() === '' ? '（空，渠道名等于后缀）' : prefix.trim()
      setStatus({
        kind: 'ok',
        text:
          kind === 'channels'
            ? `已导入 ${result.count} 条渠道并保存。${result.notes.join(' ')}`
            : `已按前缀「${shown}」套用模板 ${result.count} 条并保存。${result.notes.join(' ')}`,
      })
    } catch (error) {
      setPending(null)
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    } finally {
      setImporting(false)
    }
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
        channelInfoList: rows.map((row) => {
          const alias = row.alias.trim()
          return alias ? { channel: row.key.trim(), alias } : { channel: row.key.trim() }
        }),
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
        <PageHeader title="渠道配置" description="每个 jks 各自维护一份渠道列表。" />
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
        title="渠道配置"
        description="每个 jks 各自维护一份渠道列表，导出后可直接给 walle 的 batch2 -f 使用。"
        actions={
          <>
            {dirty ? <span className="text-xs text-muted-foreground">有未保存的修改</span> : null}
            <Button variant="outline" onClick={handleImportJson} disabled={saving || loading}>
              导入 JSON
            </Button>
            <Button variant="outline" onClick={handleExportJson} disabled={saving || loading}>
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
            <Button variant="outline" onClick={applyTemplate}>
              <Wand2 />
              按模板生成
            </Button>
            <Button variant="outline" onClick={handleExportTemplateJson} disabled={saving || loading}>
              <FileDown />
              导出模板 JSON
            </Button>
            <Button variant="outline" onClick={handleImportTemplateJson} disabled={saving || loading}>
              <FileUp />
              导入模板 JSON
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            生成规则：渠道名 = 前缀 + &quot;_&quot; + 后缀。生成的是独立副本，之后再改模板也不会影响这里。
          </p>
          <p className="text-xs text-muted-foreground">
            「导出模板 JSON」导的是模板后缀表，改完用「导入模板 JSON」按上面的前缀展开成当前 jks
            的渠道列表；它不会改动「渠道模板」页里的模板本体。
          </p>
          <p className="text-xs text-muted-foreground">
            两个「导入」都会先弹一个确认框，列出将要写入的条目，点「确认导入」才真正落盘。
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
        title={pending?.kind === 'template' ? '导入模板 JSON' : '导入渠道 JSON'}
        preview={pending?.preview ?? null}
        currentCount={rows.length}
        dirty={dirty}
        busy={importing}
        onConfirm={handleConfirmImport}
      />
    </div>
  )
}
