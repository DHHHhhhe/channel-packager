import { execFile } from 'node:child_process'
import fs from 'node:fs'
import type { CredentialVerifyResult } from '../shared/types/store'
import { resolveInData } from './paths'
import { resolveRuntimeComponentPath } from './runtime'
import { readJksFile } from './store'

/**
 * 口令通过环境变量交给 keytool，而不是 `-storepass <pw>`。
 * 后者会把明文口令写进进程命令行，任务管理器和进程列表都能看到。
 */
const STOREPASS_ENV = 'CHANNEL_PACKAGER_STOREPASS'

/**
 * 强制英文 locale。keytool 的提示语是本地化的，中文环境下输出 GBK 中文，
 * 解析标签就得先按 GBK 解码；强制英文后输出是纯 ASCII，既不用处理编码，
 * 也不受使用者系统语言影响。
 */
const FORCE_EN_LOCALE = ['-J-Duser.language=en', '-J-Duser.country=US']

interface KeytoolRun {
  code: number
  output: string
}

function runKeytool(args: string[], password: string): Promise<KeytoolRun> {
  return new Promise((resolve, reject) => {
    execFile(
      resolveRuntimeComponentPath('keytool'),
      args,
      {
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, [STOREPASS_ENV]: password },
      },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`
        // 退出码是数字说明 keytool 跑起来了并返回了失败；其它情况是进程根本没起来
        const exitCode = error ? (error as { code?: unknown }).code : 0
        if (error && typeof exitCode !== 'number') {
          reject(new Error(`无法执行 keytool：${error.message}`))
          return
        }
        resolve({ code: typeof exitCode === 'number' ? exitCode : 0, output })
      },
    )
  })
}

/** 从 `-v` 输出里取全部别名 */
function extractAliases(output: string): string[] {
  const aliases: string[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^Alias name:\s*(.+?)\s*$/.exec(line)
    if (match) {
      aliases.push(match[1])
    }
  }
  return aliases
}

function extractKeytoolError(output: string): string | null {
  const match = /^keytool error:\s*(.+)$/m.exec(output)
  return match ? match[1].trim() : null
}

/** 把 keytool 的英文报错翻成使用者能直接照做的说法 */
function describeFailure(raw: string): string {
  if (/password was incorrect|Keystore was tampered with/i.test(raw)) {
    return '口令不正确'
  }
  if (/Keystore file does not exist/i.test(raw)) {
    return '副本文件不存在'
  }
  if (/UnrecoverableKeyException/i.test(raw)) {
    return '密钥口令不正确'
  }
  if (/Invalid keystore format|not a keystore|Unrecognized keystore/i.test(raw)) {
    return '不是有效的 keystore 文件'
  }
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw
}

/**
 * 校验凭据并取出真实别名。
 * **只用 `keystoreFile` 指向的副本，从不读 `sourcePath`** —— 这是 R21 的核心。
 */
export async function verifyCredentials(
  id: string,
  password: string,
  expectedAlias?: string,
): Promise<CredentialVerifyResult> {
  const item = readJksFile().items.find((entry) => entry.id === id)
  if (!item) {
    throw new Error(`找不到 jks：${id}`)
  }
  if (!password) {
    return { ok: false, aliases: [], message: '口令不能为空' }
  }

  const keystorePath = resolveInData(item.keystoreFile)
  if (!fs.existsSync(keystorePath)) {
    return { ok: false, aliases: [], message: `副本文件不存在：${keystorePath}` }
  }

  const { code, output } = await runKeytool(
    [...FORCE_EN_LOCALE, '-list', '-v', '-keystore', keystorePath, '-storepass:env', STOREPASS_ENV],
    password,
  )

  if (code !== 0) {
    const reason = extractKeytoolError(output) ?? output.trim()
    return { ok: false, aliases: [], message: describeFailure(reason) }
  }

  const aliases = extractAliases(output)
  if (aliases.length === 0) {
    return { ok: false, aliases, message: '口令正确，但没有从 keytool 输出里读到任何别名' }
  }

  const wanted = expectedAlias?.trim()
  if (wanted && aliases.includes(wanted)) {
    return { ok: true, alias: wanted, aliases }
  }
  if (aliases.length === 1) {
    // 库里只有一个条目：别名是不是填错了都能定下来，顺手把正确的带回去
    return {
      ok: true,
      alias: aliases[0],
      aliases,
      message: wanted ? `别名「${wanted}」不在库中，已改为「${aliases[0]}」` : undefined,
    }
  }
  return {
    ok: false,
    aliases,
    message: wanted
      ? `口令正确，但库中没有别名「${wanted}」；现有条目：${aliases.join('、')}`
      : `口令正确，但库中有多个条目，需要指定别名：${aliases.join('、')}`,
  }
}
