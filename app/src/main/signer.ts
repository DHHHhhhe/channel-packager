import { createHash } from 'node:crypto'
import fs from 'node:fs'
import type { TaskLogger } from './logger'
import { runProcess, StepFailure, tailLineList } from './proc'
import { resolveRuntimeComponentPath } from './runtime'

/**
 * 口令经环境变量传给子进程。
 * apksigner 支持 `--ks-pass env:<名字>`（已实测 `sign --help` 列出该格式），
 * 所以不必像 bat 那样写 `pass:<明文>` —— 那样口令会出现在进程命令行里，
 * 任务管理器与进程列表都能看到。keytool 那边同理用 `-storepass:env`。
 */
export const STOREPASS_ENV = 'CHANNEL_PACKAGER_STOREPASS'

/**
 * java 在 Windows 上默认按系统编码（中文机器是 GBK）写 stdout/stderr，
 * 而我们按 UTF-8 解码 —— 中文路径与中文提示会变成乱码（实测 walle show 输出的
 * 中文文件名就是一堆 `ʾ��Ӧ��`）。显式指定 UTF-8 后输出可正常解码。
 */
export const JAVA_ENCODING_ARGS = [
  '-Dfile.encoding=UTF-8',
  '-Dsun.stdout.encoding=UTF-8',
  '-Dsun.stderr.encoding=UTF-8',
] as const

export interface StepContext {
  log: TaskLogger
  /** 把子进程输出行实时推给界面 */
  onLine: (line: string) => void
}

function pipe(ctx: StepContext, tag: string) {
  return (line: string): void => {
    ctx.log.child(tag, line)
    ctx.onLine(line)
  }
}

/** `zipalign -f -v 4 <输入> <输出>`，与 bat 的参数顺序一致 */
export async function zipalign(
  inputApk: string,
  outputApk: string,
  ctx: StepContext,
): Promise<void> {
  ctx.log.section('zipalign 对齐')
  const result = await runProcess(
    resolveRuntimeComponentPath('zipalign'),
    ['-f', '-v', '4', inputApk, outputApk],
    // zipalign 是原生程序，中文 Windows 上按 GBK 写控制台
    { encoding: 'gbk', onLine: pipe(ctx, 'zipalign') },
  )
  if (result.code !== 0) {
    throw new StepFailure(
      `APK 对齐失败（退出码 ${result.code}）`,
      result.code,
      tailLineList(result.stdout + result.stderr),
    )
  }
  // bat 也检查了产物存在：退出码 0 但没产出文件的情况确实会出现。
  // 这条刻意不给退出码 —— 它本来就是 0，摆出来只会让人以为工具坏了，输出末尾才是线索。
  if (!fs.existsSync(outputApk)) {
    throw new StepFailure(
      'APK 对齐报告成功但没有产出文件，已中止',
      undefined,
      tailLineList(result.stdout + result.stderr),
    )
  }
}

export interface SignParams {
  inputApk: string
  outputApk: string
  keystorePath: string
  alias: string
  storePassword: string
}

export async function signApk(params: SignParams, ctx: StepContext): Promise<void> {
  ctx.log.section('apksigner 签名')
  const result = await runProcess(
    resolveRuntimeComponentPath('java'),
    [
      ...JAVA_ENCODING_ARGS,
      '-jar',
      resolveRuntimeComponentPath('apksigner'),
      'sign',
      '--ks',
      params.keystorePath,
      '--ks-key-alias',
      params.alias,
      '--ks-pass',
      `env:${STOREPASS_ENV}`,
      '--key-pass',
      `env:${STOREPASS_ENV}`,
      '--v2-signing-enabled',
      'true',
      '--out',
      params.outputApk,
      params.inputApk,
    ],
    {
      env: { ...process.env, [STOREPASS_ENV]: params.storePassword },
      onLine: pipe(ctx, 'apksigner'),
    },
  )
  if (result.code !== 0) {
    throw new StepFailure(
      `签名失败（退出码 ${result.code}）`,
      result.code,
      tailLineList(result.stdout + result.stderr),
    )
  }
  if (!fs.existsSync(params.outputApk)) {
    throw new StepFailure(
      '签名报告成功但没有产出文件，已中止',
      undefined,
      tailLineList(result.stdout + result.stderr),
    )
  }
}

export async function verifyApk(apkPath: string, ctx: StepContext): Promise<void> {
  ctx.log.section('apksigner 校验')
  const result = await runProcess(
    resolveRuntimeComponentPath('java'),
    [...JAVA_ENCODING_ARGS, '-jar', resolveRuntimeComponentPath('apksigner'), 'verify', '-v', apkPath],
    { onLine: pipe(ctx, 'apksigner-verify') },
  )
  if (result.code !== 0) {
    throw new StepFailure(
      `签名校验未通过（退出码 ${result.code}）`,
      result.code,
      tailLineList(result.stdout + result.stderr),
    )
  }
}

interface CertProbe {
  /** 小写十六进制、不带冒号；空串表示读不出签名证书 */
  digest: string
  /** 子进程输出末尾，读不出时给使用者一点线索 */
  tail: string[]
}

/** 一个 APK 的签名情况。`digest` 为空串表示读不出证书 */
export interface ApkSignature {
  digest: string
  /**
   * 有没有 v2 签名 —— walle 把渠道写进 APK Signing Block，只认 v2。
   * `undefined` 表示 apksigner 没报这一行（不同版本输出可能不一样），
   * 这时不做拦截，让 walle 自己报错，免得因为认不出格式而挡住正常的包。
   */
  v2?: boolean
  tail: string[]
}

/**
 * 从 apksigner 的输出里挑证书 SHA-256 指纹。
 * 必须按行匹配而不是整个输出 —— `--print-certs` 会在几十上百行
 * `META-INF/... not protected by signature` 警告里夹几行证书信息。
 */
function pickCertificateDigest(output: string): string {
  for (const line of output.split(/\r?\n/)) {
    const matched = /certificate SHA-256 digest:\s*([0-9a-fA-F]{64})/.exec(line)
    if (matched) {
      return matched[1].toLowerCase()
    }
  }
  return ''
}

/**
 * apksigner 只在 `-v` 模式下报这一行，v1-only 的包这里是 false。
 * 认不出这一行时返回 undefined（见 `ApkSignature.v2` 的说明）。
 */
function pickV2Flag(output: string): boolean | undefined {
  const matched = /Verified using v2 scheme \(APK Signature Scheme v2\):\s*(true|false)/i.exec(output)
  if (!matched) {
    return undefined
  }
  return matched[1].toLowerCase() === 'true'
}

/**
 * 读 APK 的签名情况（证书指纹 + 有没有 v2）。
 *
 * `--print-certs` 与 `-v` 一起给，一次调用拿全两件事。刻意不把输出推给界面：
 * 那些 WARNING 对使用者是纯噪音，核对结果一句话就够。
 */
export async function readApkSignature(
  apkPath: string,
  ctx?: StepContext,
): Promise<ApkSignature> {
  const result = await runProcess(
    resolveRuntimeComponentPath('java'),
    [
      ...JAVA_ENCODING_ARGS,
      '-jar',
      resolveRuntimeComponentPath('apksigner'),
      'verify',
      '--print-certs',
      '-v',
      apkPath,
    ],
    {},
  )
  const output = result.stdout + result.stderr
  const digest = pickCertificateDigest(output)
  const v2 = pickV2Flag(output)
  const v2Text = v2 === undefined ? '读不出' : v2 ? '有' : '无'
  ctx?.log.info(`读输入包签名：证书 ${digest || '(读不出)'}，v2 ${v2Text}（退出码 ${result.code}）`)
  return { digest, v2, tail: tailLineList(output) }
}

/**
 * 读 keystore 里某个条目证书的 SHA-256 指纹。
 * 口令用 `-storepass:env <名字>` 从环境变量取，不落在进程命令行上；
 * `-rfc` 直接给 PEM，把 base64 解回 DER 再算 SHA-256 —— 实测与 apksigner 报的
 * `certificate SHA-256 digest` 是同一个值，所以两边可以直接比字符串。
 */
export async function probeKeystoreCertificate(
  keystorePath: string,
  alias: string,
  storePassword: string,
  ctx?: StepContext,
): Promise<CertProbe> {
  const result = await runProcess(
    resolveRuntimeComponentPath('keytool'),
    [
      // keytool.exe 是原生启动器，`-J` 把参数转给 JVM；不指定的话中文提示按 GBK 输出会乱码
      '-J-Dfile.encoding=UTF-8',
      '-J-Dsun.stdout.encoding=UTF-8',
      '-J-Dsun.stderr.encoding=UTF-8',
      '-exportcert',
      '-alias',
      alias,
      '-keystore',
      keystorePath,
      '-storepass:env',
      STOREPASS_ENV,
      '-rfc',
    ],
    { env: { ...process.env, [STOREPASS_ENV]: storePassword } },
  )
  const output = result.stdout + result.stderr
  const pem = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(output)
  if (result.code !== 0 || !pem) {
    throw new StepFailure(
      result.code === 0
        ? '没能从签名文件里读出证书，已中止'
        : `读签名文件里的证书失败（退出码 ${result.code}）`,
      result.code === 0 ? undefined : result.code,
      tailLineList(output),
    )
  }
  const der = Buffer.from(pem[1].replace(/\s+/g, ''), 'base64')
  const digest = createHash('sha256').update(der).digest('hex')
  ctx?.log.info(`读 jks 证书指纹：${digest}`)
  return { digest, tail: tailLineList(output) }
}

/**
 * 「跳过签名」的两条路径都绕不过这两条：包得读得出签名证书，且得有 v2 签名。
 * v1-only 的包 walle 会直接抛 `No APK Signing Block before ZIP Central Directory`，
 * 与其让人对着 Java 栈猜，不如在这里说清楚。
 */
function assertSkippable(apk: ApkSignature): void {
  if (apk.digest === '') {
    throw new StepFailure(
      '这个包读不出签名证书（没签名或文件损坏），跳过签名会得到装不上的包，已中止',
      undefined,
      apk.tail,
    )
  }
  if (apk.v2 === false) {
    throw new StepFailure(
      '这个包只有 v1 签名，没有 v2 签名。渠道要写进 APK Signing Block，只认 v2 —— ' +
        '先重新签名一次再拿过来，或者改用「重签名」模式。',
      undefined,
      apk.tail,
    )
  }
}

/**
 * 跳过签名前确认输入包就是所选的 jks 签出来的。
 *
 * 跳过签名 = 直接拿输入包去写渠道，输出包的签名完全由输入包决定。
 * 万一喂进来的是别的包（另一个应用、或换了 jks 之后留下的旧包），
 * 会签出一批签名对不上的渠道包，而且要到安装或覆盖更新时才暴露，所以这里直接中止。
 */
export async function assertSignedByKeystore(
  apkPath: string,
  params: { keystorePath: string; alias: string; storePassword: string; jksId: string },
  ctx: StepContext,
): Promise<void> {
  ctx.log.section('跳过签名前核对签名证书')
  const apk = await readApkSignature(apkPath, ctx)
  assertSkippable(apk)
  const keystore = await probeKeystoreCertificate(
    params.keystorePath,
    params.alias,
    params.storePassword,
    ctx,
  )
  if (apk.digest !== keystore.digest) {
    // 完整指纹进日志，界面上只给前 16 位 —— 足够区分证书，又不至于把卡片撑满
    ctx.log.error(`证书不一致：输入包 ${apk.digest} ≠ jks ${keystore.digest}`)
    throw new Error(
      `这个包不是用签名文件「${params.jksId}」签的（包里证书 ${apk.digest.slice(0, 16)}…，` +
        `签名文件里证书 ${keystore.digest.slice(0, 16)}…），跳过签名会签出签名对不上的包，已中止。` +
        '跳过签名只适用于同一个签名文件签出来的包，也就是上次出包时另存的那份「已签名未写渠道」包。',
    )
  }
  ctx.log.info('证书一致，可以跳过签名')
}

/**
 * 没有 jks 时的自查。
 *
 * 拿不到私钥就没法和某个 keystore 比对，所以这里只做那两件不需要私钥的事：
 * 包得读得出证书、得有 v2 签名。输出包的签名是否与输入包一致，由流水线在
 * 写渠道之后再核一遍 —— 那一步比这里更强，它直接验证「跳过签名没把签名改坏」。
 */
export async function assertSkippableApk(apkPath: string, ctx: StepContext): Promise<ApkSignature> {
  ctx.log.section('跳过签名前自查输入包')
  const apk = await readApkSignature(apkPath, ctx)
  assertSkippable(apk)
  ctx.log.info('输入包可以跳过签名')
  return apk
}
