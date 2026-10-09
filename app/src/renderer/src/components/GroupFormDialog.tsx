import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { GroupItem } from '@shared/types/store'

export interface GroupFormPayload {
  /** 分组名：渠道列表里显示的名字 */
  name: string
  /** 中文应用名：只在本工具里显示，不写进包 */
  appLabel: string
}

interface GroupFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = 新建 */
  group: GroupItem | null
  busy?: boolean
  onSubmit: (payload: GroupFormPayload) => void
}

/**
 * 新建 / 编辑分组。两个字段都只在本工具里用：
 * 分组名是渠道列表的标题，中文应用名是这个分组代表的应用叫什么。
 * 新建时分组名跟着中文应用名走，手动改过之后就不再自动覆盖 —— 见 Q4「分组名默认取应用名」。
 */
export function GroupFormDialog({
  open,
  onOpenChange,
  group,
  busy = false,
  onSubmit,
}: GroupFormDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [appLabel, setAppLabel] = useState('')
  /** 分组名被手动改过之后，就不再用应用名去覆盖它 */
  const [nameTouched, setNameTouched] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      return
    }
    setName(group?.name ?? '')
    setAppLabel(group?.appLabel ?? '')
    // 编辑时名字是用户自己定的，不该被应用名重写
    setNameTouched(group !== null)
    setError('')
  }, [open, group])

  const resolvedName = nameTouched ? name : name.trim() === '' ? appLabel : name

  const handleSubmit = () => {
    const nextName = resolvedName.trim()
    if (nextName === '') {
      setError('分组名不能为空 —— 渠道列表要用它区分。')
      return
    }
    setError('')
    onSubmit({ name: nextName, appLabel: appLabel.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onOpenChange(false))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{group ? '编辑分组' : '新建分组'}</DialogTitle>
          <DialogDescription>
            一个分组对应一份渠道列表。分组与签名文件无关，没有签名文件也能建。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-name">分组名</Label>
            <Input
              id="group-name"
              value={resolvedName}
              onChange={(event) => {
                setNameTouched(true)
                setName(event.target.value)
              }}
              placeholder="例如 沐爱"
            />
            <p className="text-xs text-muted-foreground">
              渠道列表的名字，用来区分不同分组。新建时默认跟随中文应用名，可以修改。
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-app-label">中文应用名</Label>
            <Input
              id="group-app-label"
              value={appLabel}
              onChange={(event) => setAppLabel(event.target.value)}
              placeholder="例如 沐爱"
            />
            <p className="text-xs text-muted-foreground">
              这个分组代表的应用叫什么。只在本工具里显示，不会写进安装包。
            </p>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? '保存中…' : group ? '保存' : '新建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
