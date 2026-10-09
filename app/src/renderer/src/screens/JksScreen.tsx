import { useState } from 'react'
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { JksFormDialog } from '@/components/JksFormDialog'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { JksItem } from '@shared/types/store'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { Spinner } from '@/components/ui/spinner'
import { useAppStore } from '@/store/app-store'

export function JksScreen() {
  const { jksItems, saveJks, refreshJks } = useAppStore()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<JksItem | undefined>(undefined)
  const [deleting, setDeleting] = useState<JksItem | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const openAdd = () => {
    setEditing(undefined)
    setDialogOpen(true)
  }

  const openEdit = (item: JksItem) => {
    setEditing(item)
    setDialogOpen(true)
  }

  const handleRefresh = async (item: JksItem) => {
    setStatus(null)
    try {
      const result = await refreshJks(item.id)
      if (result.status === 'unchanged') {
        setStatus({ kind: 'ok', text: `${item.id}：原文件与本工具内的副本一致，无需处理。` })
      } else if (result.status === 'changed') {
        setStatus({
          kind: 'error',
          text: `${item.id}：原文件已变化（SHA256 ${result.sourceSha256?.slice(0, 8)}），副本未同步。如需更新，请删除后重新新增。`,
        })
      } else {
        setStatus({ kind: 'error', text: `${item.id}：${result.message ?? '原文件不可访问。'}` })
      }
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    }
  }

  const handleDelete = async () => {
    if (!deleting) {
      return
    }
    setBusy(true)
    try {
      await saveJks({ action: 'remove', id: deleting.id })
      setStatus({
        kind: 'ok',
        text: `已删除 ${deleting.id}，本工具内的副本已清除。分组与渠道列表不受影响。`,
      })
      setDeleting(undefined)
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        description="每个签名文件只保存签名要用的别名与密码。签名与校验只使用本工具内的副本。"
        actions={
          <Button onClick={openAdd}>
            <Plus />
            新增签名文件
          </Button>
        }
      />

      {status ? (
        <p
          className={
            status.kind === 'error'
              ? 'text-sm text-destructive'
              : status.kind === 'ok'
                ? 'text-sm text-success'
                : 'text-sm text-muted-foreground'
          }
        >
          {status.text}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>已配置的签名文件</CardTitle>
          <CardDescription>共 {jksItems.length} 个</CardDescription>
        </CardHeader>
        <CardContent>
          {jksItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有签名文件。点右上角「新增签名文件」选择文件，别名与密码会按文件名自动带出。
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>显示名</TableHead>
                    <TableHead>别名</TableHead>
                    <TableHead>来源路径</TableHead>
                    <TableHead>SHA256</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jksItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.displayName}</span>
                          <Badge variant="outline">
                            {item.credentialSource === 'derived' ? '推导' : '手工'}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">{item.id}</div>
                      </TableCell>
                      <TableCell>{item.alias}</TableCell>
                      <TableCell className="max-w-[16rem] truncate" title={item.sourcePath}>
                        {item.sourcePath}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.sha256.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(item)}
                            title="编辑"
                            aria-label={`编辑 ${item.displayName}`}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRefresh(item)}
                            title="从原文件重新导入（只比对，不自动同步）"
                            aria-label={`比对 ${item.displayName} 的原文件`}
                          >
                            <RefreshCw />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleting(item)}
                            title="删除"
                            aria-label={`删除 ${item.displayName}`}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <JksFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editing}
        onFinished={(message) => setStatus({ kind: 'ok', text: message })}
      />

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => (open ? undefined : setDeleting(undefined))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除 {deleting?.displayName}</DialogTitle>
            <DialogDescription>
              只会删除本工具内的副本，无法撤销。分组与渠道列表不受影响，原文件也不受影响。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(undefined)} disabled={busy}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              {busy ? <Spinner /> : null}
              {busy ? '删除中…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
