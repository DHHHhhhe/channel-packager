# 把当前版本的发布说明并入 CHANGELOG.md。
#
#   pwsh -NoProfile -File scripts/sync-changelog.ps1
#
# 发版流程里的固定一步：改完 build/release-notes.md、改过 package.json 的 version 之后跑它，
# 更新记录里就会多出这一版。
#
# 为什么不让人手动复制：这一步很容易忘，而忘了之后要补就得翻 tag 找当时的说明。
# 脚本是幂等的 —— 同一版本已经在了就什么都不做，重复跑不会写出两条。

[CmdletBinding()]
param(
  [string]$PackageJson = (Join-Path $PSScriptRoot '..\package.json'),
  [string]$NotesFile = (Join-Path $PSScriptRoot '..\build\release-notes.md'),
  [string]$ChangelogFile = (Join-Path $PSScriptRoot '..\CHANGELOG.md'),
  [string]$Date = ''
)

$ErrorActionPreference = 'Stop'

foreach ($f in @($PackageJson, $NotesFile, $ChangelogFile)) {
  if (-not (Test-Path -LiteralPath $f)) {
    throw "找不到 $f"
  }
}

$version = (Get-Content -LiteralPath $PackageJson -Raw | ConvertFrom-Json).version
if (-not $version) {
  throw 'package.json 里没有 version'
}

$notes = (Get-Content -LiteralPath $NotesFile -Raw).Trim()
if (-not $notes) {
  throw 'release-notes.md 是空的'
}

$changelog = Get-Content -LiteralPath $ChangelogFile -Raw

# 幂等：已经有这一版就退出。匹配行首的 `## <版本> `，避免 0.3.1 误命中 0.3.10
if ([regex]::IsMatch($changelog, "(?m)^##\s+$([regex]::Escape($version))(\s|$)")) {
  Write-Output "CHANGELOG 里已经有 $version 了，没动它"
  exit 0
}

if (-not $Date) {
  $Date = Get-Date -Format 'yyyy-MM-dd'
}

# 插在第一个版本小节之前 —— 更新记录按惯例是新的在最前
$firstSection = [regex]::Match($changelog, '(?m)^##\s')
if (-not $firstSection.Success) {
  throw 'CHANGELOG.md 里找不到版本小节（应以 `## 版本号 - 日期` 开头）'
}

$head = $changelog.Substring(0, $firstSection.Index)
$tail = $changelog.Substring($firstSection.Index)
$entry = "## $version - $Date`n`n$notes`n`n"

# 行尾统一成 LF。脚本是整文件重写的，跑一次全文就统一了，
# 免得每次提交都报一句 "CRLF will be replaced by LF"。
#
# 先算进变量再传给 WriteAllText：直接在参数列表里写 -replace 会被 PowerShell
# 按逗号拆成两个参数，报「找不到参数计数为 4 的重载」。
$content = ($head + $entry + $tail) -replace "`r`n", "`n"

# 写 UTF-8 无 BOM：带 BOM 的话开头会多出一个不可见字符，界面上解析标题行会错位
[System.IO.File]::WriteAllText($ChangelogFile, $content, [System.Text.UTF8Encoding]::new($false))

Write-Output "已把 $version（$Date）并入 CHANGELOG.md"
