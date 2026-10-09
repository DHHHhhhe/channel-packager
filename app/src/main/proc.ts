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
  /** 覆盖默认的「多久没有输出就判定卡死」，传 0 表示不设限（测试用） */
  idleTimeoutMs?: number
  /**
   * 外部取消。abort 时强杀子进程，并以 `cancelled` 的 StepFailure 收尾。
   *
   * 没有它的话，长任务只能等它自己跑完 —— 用户点了取消，界面已经说「已取消」，
   * 子进程还在后台吃 CPU、还在往输出目录里写包，两边说的不是一回事。
   */
  signal?: AbortSignal
}

/**
 * 子进程多久没有任何输出就判定卡死。
 *
 * 卡住的是 walle 这类子进程：它不退出、也不打印，`await` 就永远不回来，界面一直转，
 * 用户只能强杀应用。10 分钟是保守值 —— 正常出包时最安静的一步是 apksigner 签名，
 * 100 MB 的包也就几十秒。
 */
export const CHILD_IDLE_TIMEOUT_MS = 10 * 60 * 1000

/** 判定卡死后留给进程退出的时间；到点还没 close 就不再等它，直接按失败收尾 */
const KILL_GRACE_MS = 5 * 1000

function describeDuration(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)} 秒` : `${Math.round(ms / 60_000)} 分钟`
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
  /** 进程被超时强制结束 —— 和「跑完了但退出码非 0」是两回事，界面要分开说 */
  readonly timedOut: boolean
  /**
   * 用户主动取消。与「失败」必须分开：取消是预期内的动作，
   * 报成失败会让人以为工具坏了，还会去翻根本不存在的问题。
   */
  readonly cancelled: boolean

  constructor(
    message: string,
    exitCode?: number,
    outputTail: readonly string[] = [],
    timedOut = false,
    cancelled = false,
  ) {
    super(message)
    this.name = 'StepFailure'
    this.exitCode = exitCode
    this.outputTail = outputTail
    this.timedOut = timedOut
    this.cancelled = cancelled
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
    const signal = options.signal
    if (signal?.aborted) {
      reject(new StepFailure('已取消', undefined, [], false, true))
      return
    }

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

    const idleMs = options.idleTimeoutMs ?? CHILD_IDLE_TIMEOUT_MS
    let settled = false
    let timedOut = false
    let cancelled = false
    let idleTimer: NodeJS.Timeout | undefined
    let killTimer: NodeJS.Timeout | undefined

    const clearTimers = (): void => {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer)
        idleTimer = undefined
      }
      if (killTimer !== undefined) {
        clearTimeout(killTimer)
        killTimer = undefined
      }
      // 不摘掉的话，长任务跑完很久之后外部再 abort，还会对着已退出的 child 调 kill
      signal?.removeEventListener('abort', onAbort)
    }

    const timeoutError = (): StepFailure =>
      new StepFailure(
        `超过 ${describeDuration(idleMs)}没有任何输出，已强制结束`,
        undefined,
        tailLineList(stdout + stderr),
        true,
      )

    const cancelError = (): StepFailure =>
      new StepFailure('已取消', undefined, tailLineList(stdout + stderr), false, true)

    const settleReject = (error: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimers()
      reject(error)
    }

    const onIdle = (): void => {
      timedOut = true
      // 卡住的进程不会自己退，直接强杀；杀完等 close 事件来收尾
      try {
        child.kill('SIGKILL')
      } catch {
        // 已经退了
      }
      // 万一 close 迟迟不来（进程卡在内核里），也不能让任务永远转下去
      killTimer = setTimeout(() => settleReject(timeoutError()), KILL_GRACE_MS)
    }

    const onAbort = (): void => {
      if (settled) {
        return
      }
      cancelled = true
      try {
        child.kill('SIGKILL')
      } catch {
        // 已经退了
      }
      killTimer = setTimeout(() => settleReject(cancelError()), KILL_GRACE_MS)
    }

    signal?.addEventListener('abort', onAbort, { once: true })

    /** 每次读到输出就把「多久没动静」的计时重置 */
    const armIdle = (): void => {
      if (idleMs <= 0) {
        return
      }
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer)
      }
      idleTimer = setTimeout(onIdle, idleMs)
    }

    armIdle()

    const emit = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      armIdle()
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
    child.on('error', settleReject)
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
      if (cancelled) {
        settleReject(cancelError())
        return
      }
      if (timedOut) {
        settleReject(timeoutError())
        return
      }
      if (settled) {
        return
      }
      settled = true
      clearTimers()
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}
