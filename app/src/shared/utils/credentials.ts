/**
 * 凭据推导：新装应用给用户一个合理的默认值，填进输入框后仍可手改。
 * `legacy.jks` 这类不符合规律的凭据靠用户手工覆盖（credentialSource 会变成 manual）。
 */

/** 取路径或文件名去扩展名后的基名。反斜杠与正斜杠都接受 */
export function baseNameOf(filePathOrName: string): string {
  const normalized = filePathOrName.replace(/\\/g, '/')
  const fileName = normalized.slice(normalized.lastIndexOf('/') + 1)
  return fileName.replace(/\.[^.]*$/, '')
}

/** 别名默认与 jks 基名一致 */
export function deriveAlias(filePathOrName: string): string {
  return baseNameOf(filePathOrName)
}

/** 口令默认 `<基名>@123` */
export function derivePassword(filePathOrName: string): string {
  return `${baseNameOf(filePathOrName)}@123`
}
