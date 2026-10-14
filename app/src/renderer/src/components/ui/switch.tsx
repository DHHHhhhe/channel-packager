"use client"

import * as React from "react"
import { cn } from "cn"
import { Switch as SwitchPrimitive } from "radix-ui"

/**
 * 开关。用于「立即生效的二元设置」，区别于复选框 ——
 * 复选框属于表单（改完还要点保存），开关改一下就是最终状态。
 *
 * 尺寸比按钮小一号（20×36），因为它是个控件，不该和按钮抢视线。
 * 未选中用半透明前景色而不是 --input：后者是 8% 的黑，在浅灰画布上几乎看不见。
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors outline-none",
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-foreground/15",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-card transition-transform",
          // 深色下主色是近白，浅色圆点会看不见 —— 选中时换成深色圆点
          "dark:data-[state=checked]:bg-primary-foreground",
          "data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
