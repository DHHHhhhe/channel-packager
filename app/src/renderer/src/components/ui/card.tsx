import * as React from "react"
import { cn } from "cn"

/*
 * Double-Bezel（外壳 + 内芯）：卡片看起来像嵌在托盘里的一块板子，
 * 而不是浮在背景上的一片色。
 *
 * 外壳给一圈浅底、一条 hairline 与落影；内芯是自己的白底加一道顶部内高光。
 * 内圆角按「外圆角 − 内边距」算（1.75rem − 0.375rem），两条弧才同心 ——
 * 直接套同一个圆角会出现肉眼可见的宽度不均。
 *
 * 分层注意：has-data-* 查的是后代，留在外壳上仍然有效；
 * 而 *:[img:first-child] 是直接子元素选择器，必须跟着内容一起挪到内芯。
 */
function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card-shell"
      data-size={size}
      className="rounded-[1.75rem] bg-black/[0.025] p-1.5 ring-1 ring-black/[0.04] card-shadow dark:bg-white/[0.04] dark:ring-white/[0.06]"
    >
      <div
        data-slot="card"
        className={cn(
          "group/card flex h-full flex-col gap-(--card-spacing) overflow-hidden rounded-[calc(1.75rem-0.375rem)] bg-card py-(--card-spacing) text-sm text-card-foreground [--card-px:--spacing(4)] [--card-spacing:--spacing(3)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-[calc(1.75rem-0.375rem)] *:[img:last-child]:rounded-b-[calc(1.75rem-0.375rem)]",
          className
        )}
        {...props}
      />
    </div>
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-[calc(1.75rem-0.375rem)] px-(--card-px) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

/*
 * 卡片标题渲染成真正的 h2 而不是 div：顶栏那个页面名是全文唯一的 h1，读屏
 * 用户按标题键跳转时，卡片标题是唯一的落脚点。用 div 的话整个界面只有一级
 * 标题，等于没有结构。
 */
function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="card-title"
      className={cn(
        "font-heading text-sm leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-px)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-[calc(1.75rem-0.375rem)] border-t bg-muted/50 p-(--card-spacing) px-(--card-px)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
