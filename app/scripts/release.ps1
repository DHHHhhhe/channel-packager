# 发一个 GitHub Release：构建安装包并上传（安装包 + .blockmap + latest.yml）。
#
# 用法（在仓库任意位置）：
#     pwsh -File app/scripts/release.ps1
#
# 前置条件：
#   1. origin 指向 GitHub：git remote add origin https://github.com/<账号>/<仓库>.git
#      —— 账号与仓库名从这里读出来（electron-builder 自己找不到：本仓库的 .git 在
#      app/ 的上一层，它只看 app/.git/config），再传给 --config.publish.*。
#   2. 设好 GH_TOKEN：https://github.com/settings/tokens 建一个令牌，
#      公开仓库勾 public_repo，私有仓库勾 repo。构建机器上设一次就行：
#          $env:GH_TOKEN = 'ghp_xxx'
#   3. package.json 的 version 要大于线上版本（同号不会被升级）。
#
# 上传完 Release 默认是草稿，客户端看不见，要去网页上点 Publish。

$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $PSScriptRoot
Set-Location $appDir

$version = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
Write-Host "准备发布：$version"

$remote = git config --get remote.origin.url
if (-not $remote) {
  throw '没找到 origin。先跑：git remote add origin https://github.com/<账号>/<仓库>.git'
}
if ($remote -notmatch 'github\.com') {
  throw "origin 不是 GitHub 地址：$remote"
}
if ($remote -notmatch 'github\.com[:/](?<owner>[^/]+)/(?<repo>[^/]+?)(\.git)?/?$') {
  throw "从 origin 里读不出账号/仓库名：$remote"
}
$owner = $Matches.owner
$repo = $Matches.repo
Write-Host "仓库：$owner/$repo"

if (-not $env:GH_TOKEN -and -not $env:GITHUB_TOKEN) {
  throw '没设 GH_TOKEN。建一个令牌（公开仓库勾 public_repo，私有仓库勾 repo）后 $env:GH_TOKEN=''ghp_xxx'' 再跑一次。'
}

$running = Get-Process -Name '渠道分包工具*' -ErrorAction SilentlyContinue
if ($running) {
  throw "有渠道分包工具正在运行（pid $($running.Id -join ', ')），先关掉再发版。"
}

Write-Host '=== pnpm build ==='
pnpm build
if ($LASTEXITCODE -ne 0) { throw 'pnpm build 失败，先修掉再发版。' }

Write-Host '=== electron-builder --win nsis --publish always ==='
& '.\node_modules\.bin\electron-builder.CMD' --win nsis --publish always `
  '--config.publish.provider=github' "--config.publish.owner=$owner" "--config.publish.repo=$repo"
if ($LASTEXITCODE -ne 0) { throw '构建或上传失败。' }

Write-Host ''
Write-Host "传完了。Release 默认是草稿，客户端看不见 ——"
Write-Host "打开 https://github.com/$owner/$repo/releases 把 $version 那个草稿点 Publish，同事那边就能更新了。"
