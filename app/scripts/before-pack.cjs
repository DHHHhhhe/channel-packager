// electron-builder 的 beforePack 钩子：构建前拦住「构建产物目录里躺着真实配置」。
//
// 为什么需要它：便携版把数据目录定在 exe 旁边（PORTABLE_EXECUTABLE_DIR），而 exe 就产在
// release/ 下。只要有人从 release/ 里双击过那个 exe，它就会当场生成一份 release/data，
// 里面有 jks 副本、明文口令与渠道列表。而 release/ 是构建产物目录 —— 重建或清理时会被
// 整个删掉，打包发人时也会被一起带走。所以这里直接让构建失败，逼人先把它挪走。
//
// 正常形态：exe 与 data 都在仓库外的工作目录里，release/ 只留构建产物。
//
// win-unpacked/data 是加了 zip 目标之后新增的坑：zip 打的就是 win-unpacked 整个目录，
// 只要有人从 release/win-unpacked/ 里双击过那个 exe，数据就会跟着进 zip 被发出去。

const fs = require('node:fs')
const path = require('node:path')

const RELEASE_DIR = path.join(__dirname, '..', 'release')
const DATA_DIR = path.join(RELEASE_DIR, 'data')
const PACKED_DATA_DIR = path.join(RELEASE_DIR, 'win-unpacked', 'data')

async function beforePack() {
  const found = [DATA_DIR, PACKED_DATA_DIR].filter((dir) => fs.existsSync(dir))
  if (found.length === 0) {
    return
  }

  throw new Error(
    [
      '',
      '构建已中止：构建产物目录里存在真实配置，不能和构建产物放在一起。',
      '',
      ...found.map((dir) => `  位置：${dir}`),
      '',
      '  这个目录里可能有 jks 副本、明文口令与渠道列表。release/ 是构建产物目录，',
      '  重建或清理时会被整个删除，打包分享时也会被一起带走（win-unpacked/data 会直接进 zip）。',
      '',
      '  处理办法：把 exe 和 data 一起挪到仓库外的任意工作目录（例如',
      '  D:\\工具\\渠道分包工具\\），再从那里双击 exe 使用。',
      '  要日常用文件夹版，请把 zip 解压到仓库外，别直接跑 release\\win-unpacked 里的 exe。',
      '  挪完 release/ 里就只剩构建产物了。',
      ''
    ].join('\n')
  )
}

module.exports = beforePack
// electron-builder 按「模块的 default 导出」加载钩子，两种写法都留一份更稳
module.exports.default = beforePack
