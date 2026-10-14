# 从一张源图生成 app/build/icon.ico，外加界面里用的小图。
#
# 源图是 build/icon.png（1024×1024，带 alpha）。改图形时换掉这张、重跑本脚本即可，
# 不必依赖某个只在某台机器上存在的设计源文件。
#
#   pwsh -NoProfile -File scripts/make-icon.ps1
#
# electron-builder 自己也认 build/icon.png，但 Windows 的 exe 图标走的是 .ico，
# 而 .ico 需要多档尺寸（任务栏、开始菜单、Alt+Tab、资源管理器各取一档），
# electron-builder 不会替我们从 PNG 拼一个 —— 所以这一步留在仓库里，
# 保证「换一张 PNG 就能重出全部图标」这件事是可复现的。
#
# 图形：深色圆角底，白色主干向上分叉成两个色块 —— 对应本工具的语义
# （一个包分出多个渠道包）。

[CmdletBinding()]
param(
  [string]$SourcePng = (Join-Path $PSScriptRoot '..\build\icon.png'),
  [string]$OutFile = (Join-Path $PSScriptRoot '..\build\icon.ico'),
  [string]$UiPngOut = (Join-Path $PSScriptRoot '..\src\renderer\src\assets\logo.png'),
  # 界面小图。侧栏里按 20–24 逻辑像素显示，96 足够覆盖到 4x 屏
  [int]$UiPngSize = 96
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# Windows 图标各档尺寸；256 一档在 ICO 目录项里宽高字节写 0
$sizes = @(16, 24, 32, 48, 64, 128, 256)

if (-not (Test-Path -LiteralPath $SourcePng)) {
  throw "找不到源图 $SourcePng —— 先放一张 1024×1024 的 PNG 到 build/icon.png"
}

$source = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $SourcePng).Path)
try {
  if ($source.Width -ne $source.Height) {
    throw "源图必须是正方形，当前是 $($source.Width)×$($source.Height)"
  }
  if ($source.Width -lt 256) {
    throw "源图至少要有 256×256，当前是 $($source.Width)×$($source.Height)"
  }

  function New-ScaledBitmap {
    param([System.Drawing.Image]$From, [int]$Size)

    $bmp = New-Object System.Drawing.Bitmap -ArgumentList @(
      $Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      # SourceCopy：不要和透明底混合，否则每次缩放都会把 alpha 边缘再压一遍
      $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.DrawImage($From, (New-Object System.Drawing.Rectangle -ArgumentList @(0, 0, $Size, $Size)))
    } finally {
      $g.Dispose()
    }
    return $bmp
  }

  function New-ScaledPngBytes {
    param([System.Drawing.Image]$From, [int]$TargetSize)

    # 逐级减半，最后一步落到目标尺寸。
    #
    # 不能一步到位：1024 直接插到 16 是 64 倍缩小，GDI+ 的双三次核只跨几个像素，
    # 采不到的东西就丢了，出来是一团糊。分级的每一步都只跨 2 倍，
    # 每一级都还有足够多的像素参与平均，细节能留到 16px 那一档。
    $chain = New-Object System.Collections.Generic.List[int]
    $size = $From.Width
    while ($size -gt $TargetSize) {
      $size = [Math]::Max($TargetSize, [int][Math]::Floor($size / 2))
      $chain.Add($size)
    }

    # 中间产物要回收。源图不归这里管，调用方自己 dispose
    $temporaries = New-Object System.Collections.Generic.List[System.Drawing.Bitmap]
    $current = $null
    try {
      $step = $From
      foreach ($target in $chain) {
        $next = New-ScaledBitmap -From $step -Size $target
        if ($null -ne $current) {
          $temporaries.Add($current)
        }
        $current = $next
        $step = $current
      }

      $ms = New-Object System.IO.MemoryStream
      try {
        $current.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bytes = $ms.ToArray()
      } finally {
        $ms.Dispose()
      }
      # 前置逗号：不加的话 PowerShell 会把 byte[] 拆成一个个字节输出，
      # 调用方拿到的就是 Object[] 而不是 byte[]
      return , $bytes
    } finally {
      foreach ($t in $temporaries) {
        $t.Dispose()
      }
      if ($null -ne $current) {
        $current.Dispose()
      }
    }
  }

  # ---- 组装 ICO 容器：ICONDIR + 每档 ICONDIRENTRY + PNG 数据 ----
  $images = @()
  foreach ($size in $sizes) {
    # 显式转回 byte[]。BinaryWriter 没有 Object[] 重载，
    # 传 Object[] 时 PowerShell 会静默绑定到 Write(byte) —— 只写 1 个字节且不报错。
    $png = [byte[]](New-ScaledPngBytes -From $source -TargetSize $size)
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

  # ---- 界面小图 ----
  if ($UiPngOut) {
    $uiDir = Split-Path -Parent $UiPngOut
    if (-not (Test-Path $uiDir)) {
      New-Item -ItemType Directory -Path $uiDir -Force | Out-Null
    }
    $uiBytes = [byte[]](New-ScaledPngBytes -From $source -TargetSize $UiPngSize)
    [System.IO.File]::WriteAllBytes($UiPngOut, $uiBytes)
  }
} finally {
  $source.Dispose()
}

$final = (Resolve-Path -LiteralPath $OutFile).Path
Write-Output "图标已生成"
Write-Output ("  源图：" + (Resolve-Path -LiteralPath $SourcePng).Path)
Write-Output ("  ico ：" + $final)
Write-Output ("    尺寸档：" + (($sizes | ForEach-Object { "${_}px" }) -join ', '))
Write-Output ("    体积：" + [Math]::Round((Get-Item $final).Length / 1KB, 1) + " KB")
if ($UiPngOut) {
  $uiFinal = (Resolve-Path -LiteralPath $UiPngOut).Path
  Write-Output ("  界面小图：" + $uiFinal)
  Write-Output ("    " + $UiPngSize + "px, " + [Math]::Round((Get-Item $uiFinal).Length / 1KB, 1) + " KB")
}
