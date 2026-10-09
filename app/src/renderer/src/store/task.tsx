import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { TaskInput, TaskResult, TaskRunningState } from '@shared/types/task'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { STAGE_LABELS } from '@/lib/task-report'

/**
 * 出包任务的运行时状态。
 *
 * 为什么放在最外层而不是出包页里：任务跑起来之后人常常要切到别的页面
 * （去渠道配置里补几条、去签名配置里看一眼），一离开页面组件就卸载，
 * 原来挂在页里的进度订阅跟着断掉 —— 进度丢了、结果丢了，队列循环停在
 * 等结果的那一句上再也不动，而主进程其实还在跑。
 *
 * 放到这里之后：订阅只挂一次，切页不丢状态；顶部还能一直显示「出包中」，
 * 并且随时能取消。
 */
export interface TaskValue {
  /** 有没有任务在跑 */
  running: boolean
  /** 当前阶段的中文名；没跑过时为 null */
  stage: string | null
  /** 子进程的原始输出行，最多留最近 500 行 */
  lines: string[]
  /** 最近一次跑完的结果；新一轮开始时清空 */
  result: TaskResult | null
  /** 本次运行用的参数，供结果卡片上的「重跑本次」填回表单 */
  lastRun: TaskInput | null
  /** 队列模式下「第几项 / 共几项」；不在队列里时为 null */
  queueProgress: { index: number; total: number } | null
  /** 启动一次出包，不等待跑完 */
  start: (params: TaskInput) => Promise<void>
  /**
   * 启动并等这一次跑完，返回终态结果。
   * 队列循环用它一项一项地跑：`result` 为 null 表示任务根本没启动起来。
   */
  runAndWait: (params: TaskInput) => Promise<{ result: TaskResult | null; startError: string }>
  /** 取消正在跑的任务。返回是否真的取消了 */
  cancel: () => Promise<boolean>
  /** 开新一轮之前把进度与结果清干净 */
  reset: () => void
  setQueueProgress: (value: { index: number; total: number } | null) => void
}

const TaskContext = createContext<TaskValue | null>(null)

/** 输出行留多少行。子进程刷得很快，不封顶会把内存吃满 */
const MAX_LINES = 500

export function TaskProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [result, setResult] = useState<TaskResult | null>(null)
  const [lastRun, setLastRun] = useState<TaskInput | null>(null)
  const [queueProgress, setQueueProgress] = useState<{ index: number; total: number } | null>(null)

  // null 表示「界面还没启动过任务」；此时到达的进度一定属于本次启动
  const taskIdRef = useRef<string | null>(null)
  /*
   * 队列在等这一项的最终结果。进度事件带 result 时把它叫醒，循环才往下走；
   * runTask 自己抛错时没人叫醒，所以参数允许 null 表示「这一项没结果」。
   */
  const resolveRef = useRef<((result: TaskResult | null) => void) | null>(null)

  useEffect(() => {
    const unsubscribe = window.api.onTaskProgress((event) => {
      const current = taskIdRef.current
      if (current !== null && event.taskId !== current) {
        return
      }
      setStage(STAGE_LABELS[event.stage])
      if (event.line !== undefined && event.line !== '') {
        setLines((previous) => [...previous.slice(-(MAX_LINES - 1)), event.line as string])
      } else if (event.message !== '') {
        setLines((previous) => [...previous.slice(-(MAX_LINES - 1)), `— ${event.message}`])
      }
      if (event.result) {
        setResult(event.result)
        setRunning(false)
        // 队列在等这一项跑完；叫醒它，否则循环会一直停在 await 上
        const resolve = resolveRef.current
        if (resolve !== null) {
          resolveRef.current = null
          resolve(event.result)
        }
      }
    })
    return unsubscribe
  }, [])

  /*
   * 窗口刷新（开发时的热更新、或用户自己按 F5）之后，渲染层的状态全没了，
   * 而主进程那边可能还在跑。问一句把状态接上：至少能显示「出包中」，
   * 而不是让人以为没跑过、再点一次却被「已有任务在进行」拒掉。
   *
   * 只接状态，不补历史输出 —— 那些行已经推过一次，主进程没有留存。
   */
  useEffect(() => {
    let cancelled = false
    window.api
      .getRunningTask()
      .then((state: TaskRunningState | null) => {
        if (cancelled || state === null) {
          return
        }
        taskIdRef.current = state.taskId
        setRunning(true)
        setStage(STAGE_LABELS[state.stage])
        setLines([`— ${state.message}（这个任务在本界面刷新前就已经开始了，之前的过程输出看不到）`])
      })
      .catch(() => {
        // 取不到就当没有任务在跑，不该因为这一句而让首屏报错
      })
    return () => {
      cancelled = true
    }
  }, [])

  const reset = useCallback(() => {
    setLines([])
    setResult(null)
    setStage(null)
    setRunning(false)
  }, [])

  /** 共同的起跑动作：清进度、记参数、发 IPC。返回启动错误文本（成功时为空串） */
  const launch = useCallback(async (params: TaskInput): Promise<string> => {
    setLines([])
    setResult(null)
    setStage('启动中')
    setLastRun(params)
    setRunning(true)
    try {
      const started = await window.api.runTask(params)
      taskIdRef.current = started.taskId
      return ''
    } catch (error) {
      const text = ipcErrorMessage(error)
      setRunning(false)
      setStage(STAGE_LABELS.failed)
      setLines([text])
      return text
    }
  }, [])

  const start = useCallback(
    async (params: TaskInput): Promise<void> => {
      // 单次出包：进度区只属于这一次，队列进度要收起来
      setQueueProgress(null)
      taskIdRef.current = null
      await launch(params)
    },
    [launch],
  )

  const runAndWait = useCallback(
    async (params: TaskInput): Promise<{ result: TaskResult | null; startError: string }> => {
      /*
       * 先把「等结果」的钩子挂上，再启动任务。
       *
       * 反过来写会漏事件：流水线在「校验输入」阶段就失败时几乎立刻返回，那条带
       * result 的进度事件可能比 runTask 的返回值先到，那时钩子还没挂上，这一项
       * 就会永远停在「出包中」（打包态实测踩到过）。
       * taskIdRef 仍要先清成 null，否则新任务的进度会被上一项的 taskId 过滤掉。
       */
      const waited = new Promise<TaskResult | null>((resolve) => {
        resolveRef.current = resolve
      })
      taskIdRef.current = null
      const startError = await launch(params)
      if (startError !== '') {
        // runTask 自己就抛了错，不会有结果事件来叫醒，这里手动收尾
        const resolve = resolveRef.current
        resolveRef.current = null
        if (resolve !== null) {
          resolve(null)
        }
      }
      return { result: await waited, startError }
    },
    [launch],
  )

  const cancel = useCallback(async (): Promise<boolean> => {
    try {
      return await window.api.cancelTask()
    } catch {
      // 取消本身失败不该再抛给界面 —— 真没取消成，任务跑完时的结果会说明
      return false
    }
  }, [])

  const value = useMemo<TaskValue>(
    () => ({
      running,
      stage,
      lines,
      result,
      lastRun,
      queueProgress,
      start,
      runAndWait,
      cancel,
      reset,
      setQueueProgress,
    }),
    [running, stage, lines, result, lastRun, queueProgress, start, runAndWait, cancel, reset],
  )

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>
}

export function useTask(): TaskValue {
  const value = useContext(TaskContext)
  if (!value) {
    throw new Error('useTask 必须在 TaskProvider 内使用')
  }
  return value
}
