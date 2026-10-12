import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { cn } from 'cn'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface GroupOption {
  id: string
  name: string
  appLabel: string
  /** 这个分组的渠道条数 */
  channelCount: number
}

interface GroupPickerProps {
  groups: GroupOption[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  /** 供外部的 <Label htmlFor> 指向 */
  id?: string
  'aria-label'?: string
}

/**
 * 分组的显示文本。
 *
 * 名称与应用名相同时只显示一个 —— 实测数据里绝大多数分组两者本来就一样，
 * 照原样拼成「demo（demo）」既占宽度又干扰扫读。不同名时才用「·」并列，
 * 比括号更像「两个属性」而不是「补充说明」。
 */
export function groupLabel(group: GroupOption): string {
  const name = group.name.trim()
  const appLabel = group.appLabel.trim()
  if (name === '') {
    return appLabel
  }
  return appLabel !== '' && appLabel !== name ? `${name} · ${appLabel}` : name
}

/**
 * 分组选择器：可搜索的下拉。
 *
 * 分组一多，纯滚动找就慢了，所以这里给一个输入框按名称过滤。用 radix 的 Popover
 * 加自写列表，不引 cmdk —— 本项目的 UI 依赖已经很克制，而这里要的功能（过滤 + 上下键
 * + 回车）用几十行就能覆盖，不值得为此多一个包。
 *
 * 每项右侧的渠道数来自主进程的 groupChannelCounts：分组多了之后，光看名字分不出
 * 哪个是你要的那个，「13 条」这类规模信息比名字更好认。
 */
export default function GroupPicker({
  groups,
  value,
  onChange,
  disabled = false,
  placeholder = '请选择分组',
  className,
  id,
  'aria-label': ariaLabel,
}: GroupPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const selected = groups.find((group) => group.id === value) ?? null

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (keyword === '') {
      return groups
    }
    return groups.filter((group) => groupLabel(group).toLowerCase().includes(keyword))
  }, [groups, query])

  // 每次打开都清掉搜索词：上一次留下的关键词会把这次的可选范围缩得莫名其妙，
  // 而列表短了之后用户不容易意识到「是搜索在起作用」。
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
    }
  }, [open])

  // 过滤结果变了，高亮项可能已经不在列表里，落回第一项
  useEffect(() => {
    setActiveIndex((current) => (current < filtered.length ? current : 0))
  }, [filtered])

  const pick = (id: string): void => {
    onChange(id)
    setOpen(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (filtered.length === 0 ? 0 : (current + 1) % filtered.length))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) =>
        filtered.length === 0 ? 0 : (current - 1 + filtered.length) % filtered.length,
      )
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const target = filtered[activeIndex]
      if (target) {
        pick(target.id)
      }
    }
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          type="button"
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? '选择分组'}
          disabled={disabled}
          className={cn('justify-between gap-2 font-normal', className)}
        >
          <span className={cn('truncate', selected ? '' : 'text-muted-foreground')}>
            {selected ? groupLabel(selected) : placeholder}
          </span>
          {selected ? (
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              {selected.channelCount}
            </Badge>
          ) : null}
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverPrimitive.Trigger>
      {/* 宽度跟随触发器，否则长分组名会把面板撑得比按钮还宽 */}
      <PopoverPrimitive.Content
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onKeyDown={handleKeyDown}
      >
        <div className="border-b px-2 py-1.5">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索分组"
            aria-label="搜索分组"
            className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              没有匹配「{query.trim()}」的分组
            </p>
          ) : (
            filtered.map((group, index) => (
              <button
                key={group.id}
                type="button"
                onClick={() => pick(group.id)}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
                  index === activeIndex ? 'bg-accent text-accent-foreground' : '',
                )}
              >
                <Check
                  className={cn('size-4 shrink-0', group.id === value ? 'opacity-100' : 'opacity-0')}
                />
                <span className="min-w-0 flex-1 truncate text-left">{groupLabel(group)}</span>
                <Badge variant="secondary" className="shrink-0 tabular-nums">
                  {group.channelCount}
                </Badge>
              </button>
            ))
          )}
        </div>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Root>
  )
}
