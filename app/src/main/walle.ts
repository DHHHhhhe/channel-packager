import { JAVA_ENCODING_ARGS, type StepContext } from './signer'
import { runProcess, tailLines } from './proc'
import { resolveRuntimeComponentPath } from './runtime'

function javaArgs(args: readonly string[]): string[] {
  return [...JAVA_ENCODING_ARGS, '-jar', resolveRuntimeComponentPath('walle'), ...args]
}

function pipe(ctx: StepContext, tag: string) {
  return (line: string): void => {
    ctx.log.child(tag, line)
    ctx.onLine(line)
  }
}

/**
 * `walle show` 的输出格式实测为 `<绝对路径> : <值>`（一行）。
 * 只按 ` :` 切，不要按最后一个冒号切 —— 路径里的 `C:\` 也是冒号。
 *
 * 包没写过渠道时 walle 退出码仍是 0，输出只有 `<路径> : `（冒号后为空）。
 * 这种情况必须返回空串：早先版本没有分隔符就退回整行，于是把文件路径当成了渠道号
 * 显示在界面上。没有分隔符一律视为「读不到值」，真正的报错由调用方用 raw 兜底。
 */
function valueAfterPath(raw: string): string {
  const line =
    raw
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
      .pop() ?? ''
  const separator = line.lastIndexOf(' :')
  if (separator < 0) {
    return ''
  }
  return line.slice(separator + 2).trim()
}

/**
 * `walle batch2 -f <配置> <APK> <输出目录>`。
 * 输出名规则是 `<输入包名>_<别名>.apk`，所以调用方必须先把输入包名还原成原包名，
 * 否则产物会多出一截后缀（见 pipeline 的第 3d 步）。
 */
export async function walleBatch2(
  configFile: string,
  apkPath: string,
  outDir: string,
  ctx: StepContext,
): Promise<void> {
  ctx.log.section('walle batch2 写渠道')
  const result = await runProcess(
    resolveRuntimeComponentPath('java'),
    javaArgs(['batch2', '-f', configFile, apkPath, outDir]),
    { onLine: pipe(ctx, 'walle') },
  )
  if (result.code !== 0) {
    throw new Error(`walle 写渠道失败（退出码 ${result.code}）：${tailLines(result.stdout + result.stderr)}`)
  }
}

/** 读某个 APK 的渠道号。未写渠道的包 walle 会以非 0 退出，这里如实返回而不是抛错。 */
export async function walleShowChannel(
  apkPath: string,
): Promise<{ ok: boolean; channel: string; raw: string }> {
  const result = await runProcess(
    resolveRuntimeComponentPath('java'),
    javaArgs(['show', '-c', apkPath]),
  )
  const raw = `${result.stdout}${result.stderr}`.trim()
  return { ok: result.code === 0, channel: valueAfterPath(raw), raw }
}

/** 读某个 APK 的额外信息（`defaultExtraInfo`），同样剥掉前面的路径。 */
export async function walleShowExtraInfo(apkPath: string): Promise<{ ok: boolean; raw: string }> {
  const result = await runProcess(
    resolveRuntimeComponentPath('java'),
    javaArgs(['show', '-e', apkPath]),
  )
  const raw = `${result.stdout}${result.stderr}`.trim()
  return { ok: result.code === 0, raw: valueAfterPath(raw) }
}
