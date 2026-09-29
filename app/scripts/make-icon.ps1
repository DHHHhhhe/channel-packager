# 生成 app/build/icon.ico（多尺寸 PNG 容器）。
#
# 图标是二进制产物，仓库里同时留下生成脚本，改配色/形状时重跑即可，
# 不必依赖某个只在某台机器上存在的设计源文件。
#
#   pwsh -NoProfile -File scripts/make-icon.ps1
#
# 图形：深色圆角方块 + 白色「向下箭头落入托盘」，对应本工具的语义（把 APK 收进包里出渠道包）。

[CmdletBinding()]
param(
  [string]$OutFile = (Join-Path $PSScriptRoot '..\build\icon.ico')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# Windows 图标各档尺寸；256 一档在 ICO 目录项里宽高字节写 0
$sizes = @(16, 24, 32, 48, 64, 128, 256)

function New-IconPngBytes {
  param([int]$PixelSize)

  # 所有几何量先算成标量再传参。PowerShell 里逗号的优先级高于算术运算符，
  # 直接写 New-Object X($a, $s * 0.5) 会被解析成数组相乘。
  $s = [double]$PixelSize
  $inset = $s * 0.035
  $corner = $s * 0.44
  $side = $s - 2 * $inset
  $stroke = $s * 0.075
  $cx = $s * 0.5
  $arrowTop = $s * 0.13
  $arrowStemBottom = $s * 0.44
  $headLeft = $s * 0.29
  $headRight = $s * 0.71
  $headTop = $s * 0.41
  $headTip = $s * 0.65
  $trayLeft = $s * 0.22
  $trayRight = $s * 0.78
  $trayTop = $s * 0.67
  $trayBottom = $s * 0.87

  $bmp = New-Object System.Drawing.Bitmap -ArgumentList @($PixelSize, $PixelSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    # ---- 背景：圆角方块，自上而下的深色渐变 ----
    $rect = New-Object System.Drawing.RectangleF -ArgumentList @($inset, $inset, $side, $side)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($rect.X, $rect.Y, $corner, $corner, 180, 90)
    $path.AddArc($rect.Right - $corner, $rect.Y, $corner, $corner, 270, 90)
    $path.AddArc($rect.Right - $corner, $rect.Bottom - $corner, $corner, $corner, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $corner, $corner, $corner, 90, 90)
    $path.CloseFigure()

    $dark = [System.Drawing.Color]::FromArgb(255, 0x0b, 0x0b, 0x0b)
    $light = [System.Drawing.Color]::FromArgb(255, 0x30, 0x30, 0x30)
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList @($rect, $light, $dark, 90.0)
    $g.FillPath($bg, $path)
    $bg.Dispose()
    $path.Dispose()

    # ---- 前景：白色箭头 + 托盘 ----
    $ink = [System.Drawing.Color]::FromArgb(255, 0xfa, 0xfa, 0xfa)
    $pen = New-Object System.Drawing.Pen -ArgumentList @($ink, $stroke)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $g.DrawLine($pen, [single]$cx, [single]$arrowTop, [single]$cx, [single]$arrowStemBottom)
    # 箭头头部用实心三角形：用 DrawLines 画开口折线会和竖杆叠成一个「7」字
    $head = [System.Drawing.PointF[]]@(
      [System.Drawing.PointF]::new([single]$headLeft, [single]$headTop),
      [System.Drawing.PointF]::new([single]$headRight, [single]$headTop),
      [System.Drawing.PointF]::new([single]$cx, [single]$headTip)
    )
    $inkBrush = New-Object System.Drawing.SolidBrush -ArgumentList @($ink)
    $g.FillPolygon($inkBrush, $head)
    $inkBrush.Dispose()

    $g.DrawLine($pen, [single]$trayLeft, [single]$trayTop, [single]$trayLeft, [single]$trayBottom)
    $g.DrawLine($pen, [single]$trayLeft, [single]$trayBottom, [single]$trayRight, [single]$trayBottom)
    $g.DrawLine($pen, [single]$trayRight, [single]$trayBottom, [single]$trayRight, [single]$trayTop)

    $pen.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    # 前置逗号：不加的话 PowerShell 会把 byte[] 拆成一个个字节输出，
    # 调用方拿到的就是 Object[] 而不是 byte[]
    return , $bytes
  } finally {
    $g.Dispose()
    $bmp.Dispose()
  }
}

# ---- 组装 ICO 容器：ICONDIR + 每档 ICONDIRENTRY + PNG 数据 ----
$images = @()
foreach ($size in $sizes) {
  # 显式转回 byte[]。BinaryWriter 没有 Object[] 重载，
  # 传 Object[] 时 PowerShell 会静默绑定到 Write(byte) —— 只写 1 个字节且不报错。
  $png = [byte[]](New-IconPngBytes -PixelSize $size)
  $images += [pscustomobject]@{ Size = $size; Bytes = $png }
}

$outDir = Split-Path -Parent $OutFile
if (-not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$stream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($stream)
try {
  $writer.Write([uint16]0)                # reserved
  $writer.Write([uint16]1)                # type: 1 = icon
  $writer.Write([uint16]$images.Count)

  # 目录项共 16 字节 × N，数据紧随其后
  $offset = 6 + 16 * $images.Count
  foreach ($img in $images) {
    $dim = 0
    if ($img.Size -lt 256) { $dim = [byte]$img.Size }
    $writer.Write([byte]$dim)             # width（256 记 0）
    $writer.Write([byte]$dim)             # height
    $writer.Write([byte]0)                # 调色板颜色数
    $writer.Write([byte]0)                # reserved
    $writer.Write([uint16]1)              # planes
    $writer.Write([uint16]32)             # 位深
    $writer.Write([uint32]$img.Bytes.Length)
    $writer.Write([uint32]$offset)
    $offset += $img.Bytes.Length
  }

  foreach ($img in $images) {
    $writer.Write($img.Bytes)
  }
  $writer.Flush()
  [System.IO.File]::WriteAllBytes($OutFile, $stream.ToArray())
} finally {
  $writer.Dispose()
  $stream.Dispose()
}

$final = (Resolve-Path -LiteralPath $OutFile).Path
Write-Output "已生成 $final"
Write-Output ("  尺寸档：" + (($sizes | ForEach-Object { "${_}px" }) -join ', '))
Write-Output ("  体积：" + [Math]::Round((Get-Item $final).Length / 1KB, 1) + " KB")
