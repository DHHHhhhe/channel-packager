<#
.SYNOPSIS
    准备 app/resources/bin 下的内置运行时。

.DESCRIPTION
    目标机器不保证装有 Java 与 Android SDK，因此运行时全部随包分发：
      jre/                由 Temurin JDK 17 经 jlink 裁剪产出（不从本机任何安装复制）
      zipalign.exe        取自本机 SDK build-tools
      apksigner.jar       取自本机 SDK build-tools
      walle-cli-all.jar   取自仓库根目录

    幂等：产物存在且体积与上次记录一致时跳过；-Force 强制重建。

.NOTES
    jlink 模块集为实测确定值：java.base,java.sql,java.logging,jdk.crypto.ec,jdk.jartool。
    crypto 相关模块走反射，jdeps 看不到，漏掉 jdk.crypto.ec 会在真实签名时才暴露。
    不复制本机 JDK 的原因：本机 Java 依附 Android Studio 的 jbr，其自带卸载程序，
    卸载后复制方案即失效。
#>
[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$AppDir   = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent $AppDir
$BinDir   = Join-Path $AppDir 'resources\bin'
$Manifest = Join-Path $BinDir '.manifest.json'

$JdkMajor     = 17
$JlinkModules = 'java.base,java.sql,java.logging,jdk.crypto.ec,jdk.jartool'

function Write-Step { param([string]$Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Note { param([string]$Message) Write-Host "    $Message" -ForegroundColor Yellow }

function Get-DirSizeMB {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        return 0
    }
    $sum = (Get-ChildItem $Path -Recurse -Force -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
    if (-not $sum) {
        return 0
    }
    return [math]::Round($sum / 1MB, 1)
}

function Get-FileSizeMB {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        return 0
    }
    return [math]::Round((Get-Item $Path).Length / 1MB, 2)
}

function Test-ManifestHit {
    param([string]$Key, [double]$SizeMB)
    if ($Force -or -not (Test-Path $Manifest)) {
        return $false
    }
    $saved = Get-Content $Manifest -Raw | ConvertFrom-Json
    $recorded = $saved.$Key
    if ($null -eq $recorded) {
        return $false
    }
    # 体积一致即认为产物完整，避免每次构建都重下 182 MB 的 JDK
    return [math]::Abs([double]$recorded - $SizeMB) -lt 0.5
}

function Save-Manifest {
    param([hashtable]$Entries)
    $Entries | ConvertTo-Json | Set-Content -Path $Manifest -Encoding utf8NoBOM
}

function Get-SdkBuildTools {
    $sdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk\build-tools'
    if (-not (Test-Path $sdkRoot)) {
        throw "未找到 Android SDK build-tools：$sdkRoot。zipalign.exe 与 apksigner.jar 需要从这里取，请安装 Android SDK 或手工放入 app\resources\bin。"
    }
    # 只接受形如 37.0.0 的纯版本目录，忽略 36.1.0-rc1 之类的预发布名
    $candidates = Get-ChildItem $sdkRoot -Directory |
        Where-Object { $_.Name -match '^\d+(\.\d+)+$' } |
        Sort-Object { [version]$_.Name } -Descending
    if (-not $candidates) {
        throw "Android SDK build-tools 下没有可用的版本目录：$sdkRoot"
    }
    return $candidates | Select-Object -First 1
}

function Build-Jre {
    $target = Join-Path $BinDir 'jre'
    $existingMB = Get-DirSizeMB $target

    if ((Test-Path (Join-Path $target 'bin\java.exe')) -and (Test-ManifestHit -Key 'jre' -SizeMB $existingMB)) {
        Write-Step "JRE：已存在且体积一致（$existingMB MB），跳过"
        return $existingMB
    }

    Write-Step "JRE：下载 Temurin JDK $JdkMajor 并 jlink 裁剪"
    $api = "https://api.adoptium.net/v3/assets/latest/$JdkMajor/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse"
    $asset = (Invoke-RestMethod -Uri $api -TimeoutSec 120)[0]
    $url = $asset.binary.package.link
    $expectedSha = $asset.binary.package.checksum
    if (-not $url -or -not $expectedSha) {
        throw "Adoptium 接口返回内容缺少下载地址或校验和，接口结构可能已变更。"
    }

    $work = Join-Path ([System.IO.Path]::GetTempPath()) ("channel-packager-jdk-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $work | Out-Null

    try {
        $zip = Join-Path $work 'jdk.zip'
        $sizeMB = [math]::Round($asset.binary.package.size / 1MB, 1)
        Write-Note "下载 $url"
        Write-Note "约 $sizeMB MB，请等待…"
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        Invoke-WebRequest -Uri $url -OutFile $zip -TimeoutSec 3600
        $sw.Stop()
        Write-Note ("下载完成，用时 {0:N0} 秒" -f $sw.Elapsed.TotalSeconds)

        $actualSha = (Get-FileHash -Path $zip -Algorithm SHA256).Hash
        if ($actualSha -ne $expectedSha.ToUpperInvariant()) {
            throw "JDK 校验和不匹配。期望 $expectedSha，实际 $actualSha。"
        }
        Write-Ok "SHA256 校验通过"

        $extractDir = Join-Path $work 'jdk'
        Expand-Archive -Path $zip -DestinationPath $extractDir -Force
        $jdkHome = Get-ChildItem $extractDir -Directory | Select-Object -First 1
        if (-not $jdkHome) {
            throw "解压后未找到 JDK 目录：$extractDir"
        }

        if (Test-Path $target) {
            Remove-Item $target -Recurse -Force
        }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null

        $jlink = Join-Path $jdkHome.FullName 'bin\jlink.exe'
        if (-not (Test-Path $jlink)) {
            throw "JDK 内没有 jlink.exe（$jlink）。裁剪 JRE 需要完整 JDK，不能是 JRE 发行版。"
        }

        Write-Note "jlink --add-modules $JlinkModules"
        & $jlink --add-modules $JlinkModules --output $target --strip-debug --no-header-files --no-man-pages --compress=2
        if ($LASTEXITCODE -ne 0) {
            throw "jlink 退出码 $LASTEXITCODE"
        }
        if (-not (Test-Path (Join-Path $target 'bin\java.exe'))) {
            throw "jlink 产出缺少 bin\java.exe：$target"
        }

        $mb = Get-DirSizeMB $target
        Write-Ok "JRE 裁剪完成：$mb MB"
        return $mb
    }
    finally {
        # 无论成败都清掉临时 JDK，避免残留 182 MB 的 zip 与解压产物
        if (Test-Path $work) {
            Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Copy-Component {
    param(
        [string]$Source,
        [string]$Destination,
        [string]$Label
    )
    if (-not (Test-Path $Source)) {
        throw "$Label 源文件不存在：$Source"
    }
    Copy-Item -Path $Source -Destination $Destination -Force
    $mb = Get-FileSizeMB $Destination
    Write-Ok "$Label 已复制：$mb MB"
    return $mb
}

# ---------- 主流程 ----------

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
Write-Step "输出目录：$BinDir"

$sizes = @{}

$sizes['jre'] = Build-Jre

$bt = Get-SdkBuildTools
Write-Step "SDK build-tools：$($bt.Name)"
$sizes['zipalign'] = Copy-Component -Source (Join-Path $bt.FullName 'zipalign.exe') `
    -Destination (Join-Path $BinDir 'zipalign.exe') -Label 'zipalign.exe'
$sizes['apksigner'] = Copy-Component -Source (Join-Path $bt.FullName 'lib\apksigner.jar') `
    -Destination (Join-Path $BinDir 'apksigner.jar') -Label 'apksigner.jar'

$walleSource = Join-Path $RepoRoot 'walle-cli-all.jar'
$sizes['walle'] = Copy-Component -Source $walleSource `
    -Destination (Join-Path $BinDir 'walle-cli-all.jar') -Label 'walle-cli-all.jar'

Save-Manifest -Entries $sizes

# ---------- 自检 ----------

Write-Step "自检"
$java = Join-Path $BinDir 'jre\bin\java.exe'

$javaOut = (& $java -version 2>&1 | Out-String).Trim()
Write-Note "java -version：$($javaOut -split "`n" | Select-Object -First 1)"

$apksignerOut = (& $java -jar (Join-Path $BinDir 'apksigner.jar') version 2>&1 | Out-String).Trim()
Write-Note "apksigner version：$apksignerOut"

$walleOut = (& $java -jar (Join-Path $BinDir 'walle-cli-all.jar') -v 2>&1 | Out-String).Trim()
Write-Note "walle -v：$walleOut"

$total = Get-DirSizeMB $BinDir
Write-Step "内置运行时合计：$total MB"
Write-Host ""
Write-Host "jre          $($sizes['jre']) MB" -ForegroundColor Gray
Write-Host "zipalign.exe $($sizes['zipalign']) MB" -ForegroundColor Gray
Write-Host "apksigner.jar $($sizes['apksigner']) MB" -ForegroundColor Gray
Write-Host "walle jar    $($sizes['walle']) MB" -ForegroundColor Gray
