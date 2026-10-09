import { LoaderCircle } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from 'cn'

/*
 * 全站唯一的「进行中」视觉。
 *
 * 尺寸只给一档：它总是和文字排在同一行，字号由调用方的 text-* 决定，这里跟着走。
 * 默认对读屏隐藏 —— 每一处用法都配了「正在X…」这类文字，让转圈再念一遍是噪音。
 */
function Spinner({
  className,
  ...props
}: ComponentProps<typeof LoaderCircle>) {
  return (
    <LoaderCircle
      data-slot="spinner"
      aria-hidden="true"
      className={cn('size-4 shrink-0 animate-spin', className)}
      {...props}
    />
  )
}

export { Spinner }
