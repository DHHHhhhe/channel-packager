import fs from 'node:fs'
import type { TaskLogger } from './logger'
import { runProcess, tailLines } from './proc'
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
    throw new Error(`zipalign 失败（退出码 ${result.code}）：${tailLines(result.stdout + result.stderr)}`)
  }
  // bat 也检查了产物存在：退出码 0 但没产出文件的情况确实会出现
  if (!fs.existsSync(outputApk)) {
    throw new Error('zipalign 报告成功但没有产出文件，已中止')
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
    throw new Error(
      `apksigner 签名失败（退出码 ${result.code}）：${tailLines(result.stdout + result.stderr)}`,
    )
  }
  if (!fs.existsSync(params.outputApk)) {
    throw new Error('apksigner 报告成功但没有产出文件，已中止')
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
    throw new Error(`apksigner 校验未通过：${tailLines(result.stdout + result.stderr)}`)
  }
}
