import { spawn } from 'node:child_process'

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /**
   * 子进程输出的编码。
   * java 工具用 `utf8`（我们已强制 `-Dfile.encoding=UTF-8`）；`zipalign.exe` 是原生
   * C++ 程序，在中文 Windows 上按 GBK 写控制台，按 UTF-8 解会得到 `ʾ��Ӧ��` 这样的乱码。
   */
  encoding?: 'utf8' | 'gbk'
  /** 每读到一个完整行回调一次，用于把子进程输出实时推给界面 */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void
}

export interface RunOutcome {
  code: number
  stdout: string
  stderr: string
}

/** 子进程报错时默认往回看多少行：15 行足够覆盖 walle 那种「真正的错在第 8 行」的情况 */
export const FAILURE_TAIL_LINES = 15

/** 取输出末尾若干行（竖排数组），用来把子进程的真实报错带给用户，而不是只说一句「失败了」 */
export function tailLineList(text: string, max = FAILURE_TAIL_LINES): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return lines.slice(-max)
}

/** 取输出末尾若干行，拼成一句话 —— 用在「只有一行位置」的 message 里 */
export function tailLines(text: string, max = 6): string {
  return tailLineList(text, max).join(' / ')
}

/**
 * 带诊断信息的步骤失败。
 *
 * 消息本身只说到「哪一步、退出码多少」，子进程输出的末尾若干行单独放在
 * `outputTail` 里：界面要竖排展示，日志里也已经逐行记过，塞进 message 会重复。
 */
export class StepFailure extends Error {
  readonly exitCode?: number
  readonly outputTail: readonly string[]

  constructor(message: string, exitCode?: number, outputTail: readonly string[] = []) {
    super(message)
    this.name = 'StepFailure'
    this.exitCode = exitCode
    this.outputTail = outputTail
  }
}

/**
 * 统一的子进程调用入口。
 *
 * 一律用 spawn 的**数组参数**形式，不拼 shell 字符串：中文路径与中文文件名
 * （例如 `示例应用_V1.4.6_..._应用宝.apk`）必须原样传给子进程，拼字符串会被
 * 引号与空格规则弄坏，这是 bat 版最容易踩的坑。
 */
export function runProcess(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    // 一次 read 可能把一行、甚至把一个多字节字符切成两半：
    // 行余量按流各留一份，字符余量交给 TextDecoder 的流式模式处理
    const pending: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' }
    const decoder = new TextDecoder(options.encoding === 'gbk' ? 'gbk' : 'utf-8')

    const emit = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      const text = decoder.decode(chunk, { stream: true })
      if (stream === 'stdout') {
        stdout += text
      } else {
        stderr += text
      }
      if (!options.onLine) {
        return
      }
      const parts = (pending[stream] + text).split(/\r?\n/)
      pending[stream] = parts.pop() ?? ''
      for (const line of parts) {
        if (line.trim() !== '') {
          options.onLine(line, stream)
        }
      }
    }

    child.stdout.on('data', (chunk: Buffer) => emit(chunk, 'stdout'))
    child.stderr.on('data', (chunk: Buffer) => emit(chunk, 'stderr'))
    child.on('error', reject)
    child.on('close', (code) => {
      // 冲刷解码器里可能残留的半个字符
      const tail = decoder.decode()
      if (tail !== '') {
        stdout += tail
        if (options.onLine && tail.trim() !== '') {
          options.onLine(tail, 'stdout')
        }
      }
      if (options.onLine) {
        for (const stream of ['stdout', 'stderr'] as const) {
          if (pending[stream].trim() !== '') {
            options.onLine(pending[stream], stream)
          }
        }
      }
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}
