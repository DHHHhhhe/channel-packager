import fs from 'node:fs'
import path from 'node:path'
import type { ChannelConfig, ChannelEntry, JksItem } from '../shared/types/store'
import type { TaskArtifact, TaskFailure, TaskInput, TaskResult, TaskStage } from '../shared/types/task'
import { createTaskLogger } from './logger'
import { resolveInData } from './paths'
import { StepFailure } from './proc'
import { readChannels, readJksFile } from './store'
import { assertSignedByKeystore, signApk, verifyApk, zipalign, type StepContext } from './signer'
import { walleBatch2, walleShowChannel } from './walle'

/**
 * 重签名后另存的那份「已签名但还没写渠道」的包，文件名里带的标记。
 * 它本身也是一个可以继续用的输入包（跳过签名时就用它），所以再次出包时
 * 要先把这段标记从包名里剥掉，否则产物名会一段段往上叠。
 */
export const SIGNED_STEM_SUFFIX = '_已签名_未写渠道'

function stripSignedStemSuffix(base: string): string {
  return base.endsWith(SIGNED_STEM_SUFFIX)
    ? base.slice(0, base.length - SIGNED_STEM_SUFFIX.length)
    : base
}

export interface PipelineHooks {
  onProgress: (stage: TaskStage, message: string, line?: string) => void
}

/** 时间戳 + 随机后缀，保证工作目录唯一 */
export function newTaskId(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`
}

interface Prepared {
  apkPath: string
  /** 不带扩展名的原包名，walle 的产物名与 3d/3e 都以它为准 */
  apkBase: string
  apkDir: string
  item: JksItem
  keystorePath: string
  pickedEntries: ChannelEntry[]
  outputDir: string
}

function prepare(input: TaskInput): Prepared {
  const apkPath = input.apkPath.trim()
  if (apkPath === '') {
    throw new Error('尚未选择 APK')
  }
  if (!fs.existsSync(apkPath)) {
    throw new Error(`APK 不存在：${apkPath}`)
  }
  if (!fs.statSync(apkPath).isFile()) {
    throw new Error(`APK 路径不是文件：${apkPath}`)
  }
  if (!apkPath.toLowerCase().endsWith('.apk')) {
    throw new Error('输入文件的后缀不是 .apk')
  }

  const item = readJksFile().items.find((entry) => entry.id === input.jksId)
  if (!item) {
    throw new Error(`找不到 jks：${input.jksId}`)
  }
  if (item.alias.trim() === '') {
    throw new Error(`jks「${item.id}」还没有别名，请先到「签名配置」补上`)
  }
  if (item.storePassword === '') {
    throw new Error(`jks「${item.id}」还没有口令，请先到「签名配置」补上`)
  }

  // R21：签名只用 data/keystores/ 下的副本，sourcePath 仅用于显示与比对
  const keystorePath = resolveInData(item.keystoreFile)
  if (!fs.existsSync(keystorePath)) {
    throw new Error(`jks 副本不存在（${item.keystoreFile}），请到「签名配置」重新导入`)
  }

  if (input.channelCodes.length === 0) {
    throw new Error('尚未勾选任何渠道')
  }
  const config = readChannels(item.id, item.app)
  const wanted = new Set(input.channelCodes)
  const missing = input.channelCodes.filter(
    (code) => !config.channelInfoList.some((entry) => entry.channel === code),
  )
  if (missing.length > 0) {
    throw new Error(`这些渠道不在该 jks 的渠道列表里：${missing.join('、')}`)
  }
  const pickedEntries = config.channelInfoList.filter((entry) => wanted.has(entry.channel))
  if (pickedEntries.length === 0) {
    throw new Error('筛选后没有可用的渠道条目')
  }

  const outputDir = input.outputDir.trim()
  if (outputDir === '') {
    throw new Error('尚未设置输出目录')
  }

  return {
    apkPath,
    apkBase: stripSignedStemSuffix(path.basename(apkPath, path.extname(apkPath))),
    apkDir: path.dirname(apkPath),
    item,
    keystorePath,
    pickedEntries,
    outputDir,
  }
}

/**
 * 按 design.md 的 7 步跑完一次出包。
 * 刻意不抛异常：失败也返回 `ok: false` 的 TaskResult，调用方只处理返回值。
 */
export async function runPipeline(
  taskId: string,
  input: TaskInput,
  hooks: PipelineHooks,
): Promise<TaskResult> {
  const log = createTaskLogger(taskId)
  const warnings: string[] = []
  const artifacts: TaskArtifact[] = []
  let workDir = ''
  let outputDir = input.outputDir

  // 子进程输出行需要知道当前属于哪个阶段，所以把阶段记在闭包里
  let currentStage: TaskStage = 'validate'
  const progress = (stage: TaskStage, message: string, line?: string): void => {
    currentStage = stage
    hooks.onProgress(stage, message, line)
  }

  const finish = (ok: boolean, message: string, failure?: TaskFailure): TaskResult => {
    if (!ok) {
      log.error(message)
    }
    return {
      taskId,
      ok,
      message,
      outputDir,
      workDir,
      logFile: log.file,
      artifacts,
      warnings,
      // 成功时不写这个键，避免结果里多一个恒为 undefined 的字段
      ...(failure ? { failure } : {}),
    }
  }

  try {
    progress('validate', '校验输入')
    const p = prepare(input)
    outputDir = p.outputDir
    log.info(`输入 APK：${p.apkPath}`)
    log.info(`jks：${p.item.id}（别名 ${p.item.alias}）`)
    log.info(`签名模式：${input.signMode}`)
    log.info(`渠道（${p.pickedEntries.length}）：${p.pickedEntries.map((e) => e.channel).join('、')}`)

    progress('prepare', '准备工作目录')
    fs.mkdirSync(outputDir, { recursive: true })
    /*
     * 每次开始出包先把上一轮的 .work 整个清掉。
     * 失败时刻意保留中间产物便于排查，但那些目录对下一次没有任何用处，
     * 留着只会越堆越多，还会让「这次的中间产物」混进上一次的残留里。
     */
    const workRoot = path.join(outputDir, '.work')
    fs.rmSync(workRoot, { recursive: true, force: true })
    workDir = path.join(workRoot, taskId)
    fs.mkdirSync(workDir, { recursive: true })
    log.info(`工作目录：${workDir}`)

    const ctx: StepContext = {
      log,
      onLine: (line) => hooks.onProgress(currentStage, '', line),
    }

    // 第 5 步的输入：跳过签名时直接用原包
    let sourceApk = p.apkPath

    if (input.signMode === 'skip') {
      /*
       * 跳过签名 = 直接拿输入包去写渠道，输出包的签名完全由输入包决定。
       * 所以先核对它是不是所选的 jks 签的，别到安装或覆盖更新时才发现签名对不上。
       */
      progress('check-source', '核对输入包的签名证书')
      log.info('signMode = skip，跳过 3a–3e')
      await assertSignedByKeystore(
        p.apkPath,
        {
          keystorePath: p.keystorePath,
          alias: p.item.alias,
          storePassword: p.item.storePassword,
          jksId: p.item.id,
        },
        ctx,
      )

      /*
       * walle 按「输入包名 + 别名」命名产物，而输入包名里可能还带着上一轮留下的
       * 「已签名未写渠道」标记。复制到工作目录时顺手把名字还原，产物名才不会
       * 一段段往上叠（名字本来就干净时不做这次复制）。
       */
      if (path.basename(p.apkPath, path.extname(p.apkPath)) !== p.apkBase) {
        const restored = path.join(workDir, `${p.apkBase}.apk`)
        fs.copyFileSync(p.apkPath, restored)
        sourceApk = restored
        log.info(`输入包名带「已签名未写渠道」标记，已复制为：${restored}`)
      }
    } else {
      const aligned = path.join(workDir, 'aligned.apk')
      const signed = path.join(workDir, 'signed.apk')

      progress('align', 'zipalign 对齐')
      await zipalign(p.apkPath, aligned, ctx)

      progress('sign', 'apksigner 重签名')
      await signApk(
        {
          inputApk: aligned,
          outputApk: signed,
          keystorePath: p.keystorePath,
          alias: p.item.alias,
          storePassword: p.item.storePassword,
        },
        ctx,
      )

      progress('verify-sign', '校验签名')
      await verifyApk(signed, ctx)

      /*
       * 3d：把重签名结果还原成原包名。
       * walle 按「输入包名 + 别名」命名产物，若直接拿 signed.apk 去跑，产物会变成
       * <原包名>_signed_<别名>.apk，就得像 bat 那样再加一段正则清理。在这里还原，
       * 产物名天然正确，从根上消掉这个问题（K5）。
       */
      progress('rename', '还原为原包名')
      const restored = path.join(workDir, `${p.apkBase}.apk`)
      fs.copyFileSync(signed, restored)
      sourceApk = restored

      /*
       * 3e：另存一份「已签名未写渠道」的包，供人工核对；它本身也是一个可用的输入包，
       * 下次出包选「跳过签名」直接喂它就行。按设计只告警不中止。
       */
      progress('resigned-copy', '另存已签名未写渠道的包')
      try {
        const resigned = path.join(p.apkDir, `${p.apkBase}${SIGNED_STEM_SUFFIX}.apk`)
        fs.copyFileSync(signed, resigned)
        log.info(`已另存：${resigned}`)
      } catch (error) {
        const note = `另存「已签名未写渠道」包失败（不影响出包）：${error instanceof Error ? error.message : String(error)}`
        warnings.push(note)
        log.error(note)
      }
    }

    progress('channel-json', '写渠道配置')
    const config: ChannelConfig = {
      defaultExtraInfo: { app: p.item.app },
      channelInfoList: p.pickedEntries,
    }
    const configFile = path.join(workDir, 'channel.json')
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8')
    log.info(`渠道配置：${configFile}`)

    const outDir = path.join(workDir, 'out')
    fs.mkdirSync(outDir, { recursive: true })

    progress('walle', 'walle 写渠道')
    await walleBatch2(configFile, sourceApk, outDir, ctx)

    /*
     * 第 6 步：先落到 work/out，用 walle show 读回渠道号再发布。
     * 按文件内容判定而不是按文件名猜 —— 别名字段是选填的，walle 在没别名时
     * 用什么命名没有明确契约，读回真实渠道号更可靠。
     */
    progress('check', '校验产物渠道号')
    const produced = fs.readdirSync(outDir).filter((name) => name.toLowerCase().endsWith('.apk'))
    if (produced.length === 0) {
      throw new Error('walle 没有产出任何渠道包')
    }
    if (produced.length !== p.pickedEntries.length) {
      warnings.push(`勾选 ${p.pickedEntries.length} 个渠道，实际产出 ${produced.length} 个包`)
    }
    for (const fileName of produced) {
      const full = path.join(outDir, fileName)
      const shown = await walleShowChannel(full)
      const expected = p.pickedEntries.find((entry) => entry.channel === shown.channel)
      const verified = shown.ok && Boolean(expected)
      if (!verified) {
        warnings.push(`${fileName}：渠道号校验未通过（读回「${shown.channel || '空'}」）`)
      }
      artifacts.push({
        channel: shown.channel,
        alias: expected?.alias,
        fileName,
        path: full,
        actualChannel: shown.channel,
        verified,
        note: verified
          ? undefined
          : shown.ok
            ? '读回的渠道号不在勾选列表里'
            : 'walle show 未能读出渠道号',
      })
      log.info(`校验 ${fileName} → ${shown.channel || '(空)'}${verified ? ' ✓' : ' ✗'}`)
    }

    progress('publish', '移动到输出目录')
    for (const artifact of artifacts) {
      const target = path.join(outputDir, artifact.fileName)
      if (fs.existsSync(target)) {
        warnings.push(`输出目录已存在同名文件，已覆盖：${artifact.fileName}`)
        fs.rmSync(target)
      }
      fs.renameSync(artifact.path, target)
      artifact.path = target
    }

    const failedCount = artifacts.filter((artifact) => !artifact.verified).length
    const message =
      failedCount === 0
        ? `完成，产出 ${artifacts.length} 个渠道包`
        : `完成，产出 ${artifacts.length} 个渠道包，其中 ${failedCount} 个渠道号校验未通过`

    /*
     * 成功后清掉工作目录（日志另有 data/logs 一份，不受影响）；
     * 失败时保留，便于对着中间产物排查。
     */
    try {
      fs.rmSync(workDir, { recursive: true, force: true })
    } catch (error) {
      warnings.push(`清理工作目录失败：${error instanceof Error ? error.message : String(error)}`)
    }

    progress('done', message)
    log.section('完成')
    return finish(true, message)
  } catch (error) {
    /*
     * 先记下失败时所在的阶段，再报 failed —— progress 会把 currentStage 改成 'failed'，
     * 而界面要的是「卡在 apksigner 签名」这种信息，光说一句「失败」等于没说。
     */
    const failedStage = currentStage
    const message = error instanceof Error ? error.message : String(error)
    const failure: TaskFailure = { stage: failedStage }
    if (error instanceof StepFailure) {
      if (error.exitCode !== undefined) {
        failure.exitCode = error.exitCode
      }
      if (error.outputTail.length > 0) {
        failure.outputTail = [...error.outputTail]
      }
    }
    log.error(`失败于「${failedStage}」阶段`)
    progress('failed', message)
    return finish(false, message, failure)
  }
}
