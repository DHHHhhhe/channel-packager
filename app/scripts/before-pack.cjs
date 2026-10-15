// electron-builder 的 beforePack 钩子：构建前拦住「构建产物目录里躺着真实配置」。
//
// 为什么需要它：数据目录默认落在 exe 旁边，而 exe 就产在 release/ 下 —— nsis 打包用的
// release/win-unpacked/ 也在那儿。只要有人从那些目录里双击过 exe，它就会当场生成一份 data，
// 里面有 jks 副本、明文口令与渠道列表。而 release/ 是构建产物目录：重建或清理时会被整个删掉，
// 而 nsis 打的正是 win-unpacked/，那份 data 会跟着进安装包被发出去。
// 所以这里直接让构建失败，逼人先把它挪走。
//
// 正常形态：从安装版启动（数据在 %LOCALAPPDATA%\渠道分包工具\data），release/ 只留构建产物。

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
      '  重建或清理时会被整个删除，而 nsis 打的正是 win-unpacked/，那份 data 会跟着进安装包。',
      '',
      '  处理办法：把那个 data 目录挪到仓库外，或者直接删掉 —— 用安装版时数据在',
      '  %LOCALAPPDATA%\\渠道分包工具\\data，本来就不该出现在构建目录里。',
      '  也别直接双击 release/ 或 release/win-unpacked/ 里的 exe 来日常使用。',
      '  挪完 release/ 里就只剩构建产物了。',
      ''
    ].join('\n')
  )
}

module.exports = beforePack
// electron-builder 按「模块的 default 导出」加载钩子，两种写法都留一份更稳
module.exports.default = beforePack
