import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { RuntimeCheckResult, RuntimeComponent } from '../shared/types/runtime'

interface ComponentSpec {
  key: string
  label: string
  /** 相对 BIN 目录 */
  relativePath: string
}

const COMPONENT_SPECS: readonly ComponentSpec[] = [
  { key: 'java', label: 'Java 运行时', relativePath: 'jre/bin/java.exe' },
  { key: 'keytool', label: '密钥库工具', relativePath: 'jre/bin/keytool.exe' },
  { key: 'jar', label: '配置包打包工具', relativePath: 'jre/bin/jar.exe' },
  { key: 'zipalign', label: '安装包对齐工具', relativePath: 'zipalign.exe' },
  { key: 'apksigner', label: '签名工具', relativePath: 'apksigner.jar' },
  { key: 'walle', label: '渠道写入工具', relativePath: 'walle-cli-all.jar' },
]

/**
 * 内置运行时根目录。
 * 打包后 electron-builder 的 extraResources 把 `resources/bin` 放到 `resources/bin`，
 * 与开发期的 `app/resources/bin` 内部布局一致，所以只有根目录需要分支。
 */
export function resolveBinDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(app.getAppPath(), 'resources', 'bin')
}

/** 组件清单里合法的 key */
export type RuntimeComponentKey = (typeof COMPONENT_SPECS)[number]['key']

/**
 * 取某个运行时组件的绝对路径。
 * 调用方不要自己拼 `jre/bin/keytool.exe` 这类相对路径 —— 布局只在这里定义一份。
 */
export function resolveRuntimeComponentPath(key: RuntimeComponentKey): string {
  const spec = COMPONENT_SPECS.find((entry) => entry.key === key)
  if (!spec) {
    throw new Error(`未知的运行时组件：${key}`)
  }
  return path.join(resolveBinDir(), spec.relativePath)
}

function inspect(binDir: string, spec: ComponentSpec): RuntimeComponent {
  const fullPath = path.join(binDir, spec.relativePath)
  let sizeBytes = 0
  try {
    sizeBytes = fs.statSync(fullPath).size
  } catch {
    // 文件不存在、被删或不可读，一律按缺失处理：调用方只需要知道能不能用，
    // 具体是哪一种异常对使用者没有区别（都只能重跑 prepare:runtime 修复）。
    sizeBytes = 0
  }
  return {
    key: spec.key,
    label: spec.label,
    path: fullPath,
    exists: sizeBytes > 0,
    sizeBytes,
  }
}

/** 逐项检查内置运行时，不做进程探测 —— 启动路径上不能起 5 个子进程 */
export function checkRuntime(): RuntimeCheckResult {
  const binDir = resolveBinDir()
  const components = COMPONENT_SPECS.map((spec) => inspect(binDir, spec))
  return {
    binDir,
    components,
    ok: components.every((component) => component.exists),
  }
}
