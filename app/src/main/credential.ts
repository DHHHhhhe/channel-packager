import { execFile } from 'node:child_process'
import fs from 'node:fs'
import type { CredentialField, CredentialVerifyResult } from '../shared/types/store'
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
          reject(new Error(`无法执行签名校验程序：${error.message}`))
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

/**
 * 把 keytool 的英文报错翻成使用者能直接照做的说法，并指出该回去查哪一项。
 * 界面只负责把 `field` 对应的输入框标红，不必去猜文案里有没有「口令」两个字。
 */
function describeFailure(raw: string): { message: string; field: CredentialField } {
  if (/password was incorrect|Keystore was tampered with/i.test(raw)) {
    return { message: '密码不正确', field: 'password' }
  }
  if (/Keystore file does not exist/i.test(raw)) {
    return { message: '副本文件不存在', field: 'keystore' }
  }
  if (/UnrecoverableKeyException/i.test(raw)) {
    return { message: '密钥密码不正确', field: 'password' }
  }
  if (/Invalid keystore format|not a keystore|Unrecognized keystore/i.test(raw)) {
    return { message: '不是有效的签名文件', field: 'keystore' }
  }
  return {
    message: raw.length > 200 ? `${raw.slice(0, 200)}…` : raw,
    field: 'keystore',
  }
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
    throw new Error(`找不到签名文件：${id}`)
  }
  if (!password) {
    return { ok: false, aliases: [], message: '密码不能为空', field: 'password' }
  }

  const keystorePath = resolveInData(item.keystoreFile)
  if (!fs.existsSync(keystorePath)) {
    return {
      ok: false,
      aliases: [],
      message: `副本文件不存在：${keystorePath}`,
      field: 'keystore',
    }
  }

  const { code, output } = await runKeytool(
    [...FORCE_EN_LOCALE, '-list', '-v', '-keystore', keystorePath, '-storepass:env', STOREPASS_ENV],
    password,
  )

  if (code !== 0) {
    const reason = extractKeytoolError(output) ?? output.trim()
    const { message, field } = describeFailure(reason)
    return { ok: false, aliases: [], message, field }
  }

  const aliases = extractAliases(output)
  if (aliases.length === 0) {
    return {
      ok: false,
      aliases,
      message: '密码正确，但没有从签名文件里读到任何别名',
      field: 'keystore',
    }
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
    field: 'alias',
    message: wanted
      ? `密码正确，但没有别名「${wanted}」；现有条目：${aliases.join('、')}`
      : `密码正确，但签名文件里有多个条目，需要指定别名：${aliases.join('、')}`,
  }
}
