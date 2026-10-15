/**
 * APK 清单里我们关心的几项。
 *
 * 读不出的字段一律留空串，调用方据此决定退到什么匹配方式 —— 不猜。
 */
export interface ApkManifest {
  /** 包名，如 com.example.app。manifest 的 package 属性，编译后仍是字面串，一定读得到 */
  packageName: string
  versionName: string
  versionCode: string
  /**
   * 应用名（android:label）。
   *
   * 只在它是**字面字符串**时读得到。编译后的清单里这一项多数时候是资源引用
   * （形如 @0x7f0e0001），要解出真正的名字得再解析 resources.arsc —— 那是另一件事，
   * 这里不做，读不到就留空串。
   */
  label: string
}
