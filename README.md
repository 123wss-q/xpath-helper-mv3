# XPath Helper (MV3)

基于 **XPath Helper 2.0.2** 的非官方 Chrome Manifest V3 适配版，采用 **Apache-2.0** 许可证。

Unofficial Manifest V3 adaptation of XPath Helper 2.0.2, licensed under Apache-2.0.

用于在网页中生成、编辑和执行 XPath，查看匹配结果并高亮元素。本项目独立维护，不是 Google、原作者或 Chrome 网上应用店的官方更新。

## 安装

1. 从 [Releases](https://github.com/123wss-q/xpath-helper-mv3/releases) 下载 `XPath-Helper-MV3-v2.0.3.zip`，解压到准备长期保留的位置。也可以点击本仓库的 **Code → Download ZIP** 下载源码并解压。
2. 打开 `chrome://extensions`，开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择**直接包含 `manifest.json` 的目录**。
4. 刷新准备使用的网页，点击扩展图标或按 `Ctrl+Shift+X` 打开面板。

安装后请保留该目录；移动或删除运行文件会影响扩展使用。更新文件后，在扩展管理页点击“重新加载”，再刷新网页。如安装了原版，建议关闭原版，避免快捷键冲突。

本发布提供 ZIP 供解压加载。自行打包的 CRX 可能因来源验证被 Chrome 禁用。参考 [Chrome 官方本地加载说明](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)。

## 使用

| 操作 | 功能 |
| --- | --- |
| `Ctrl+Shift+X`，macOS 为 `Command+Shift+X` | 打开或关闭面板 |
| 打开面板后按住 `Shift`，移动鼠标到网页元素上 | 生成 XPath 并显示结果 |
| 在 Query 输入 XPath | 查看结果、匹配数量和元素高亮 |
| 按住 `Shift`，将鼠标移动到面板上 | 将面板切换到页面顶部或底部 |

## 相对原版的改动

- 将 Manifest V2 后台页面迁移为 Manifest V3 service worker，使用 `chrome.action`。
- 更新网页可访问资源声明，去除原商店更新地址。
- 增加面板就绪握手，修复初始化时序和空查询状态。
- 按所在标签页隔离结果消息，避免不同标签页相互覆盖。
- 使用 `input` 事件响应输入和粘贴。
- 换用本项目绘制的几何图标；没有沿用原图标或打包字体。

## 页面访问与数据

内容脚本使用 `<all_urls>` 匹配规则，在浏览器允许访问的页面读取 DOM、计算 XPath，并添加面板和高亮。使用时可以查看和调整 Chrome 扩展详情页中的网站访问设置。

当前实现不包含账号登录、遥测、广告、远程代码加载或将查询及网页内容上传服务器的逻辑。

## 已知限制

- Chrome 内置页面、Chrome 网上应用店等受保护页面无法使用。
- 安装或重新加载后，已经打开的网页需要刷新。
- 只检查顶层页面，不检查嵌套 iframe 或 Shadow DOM 内部元素。
- 检查本地 HTML 文件，需要在扩展详情中开启“允许访问文件网址”。
- 保留原版 XPath 生成规则；含引号的属性、复杂 SVG 或动态网页可能需要手动调整表达式。
- 受组织管理的浏览器可能限制开发者模式或本地扩展加载。

## 验证与开发

无构建步骤，也没有需要安装的运行依赖。可用 Node.js 执行检查：

```sh
node --check background.js
node --check bar.js
node --check content.js
node tests/routing.cjs
```

现有 9 项检查使用模拟 Chrome/DOM API，覆盖消息路由、标签页隔离、面板初始化和声明资源。改版已有用户反馈在 Chrome 中成功安装使用；这不代表完成了所有浏览器和页面的兼容性回归。

## 来源与许可证

本项目以 **XPath Helper 2.0.2** 扩展包为修改基础，原项目源码位于 [google/xpaf 的 chrome 目录](https://github.com/google/xpaf/tree/master/chrome)。原包 `package.json` 声明 `Apache-2.0`，JavaScript 和 CSS 中保留以下原始版权声明：

```text
Copyright 2011 Google Inc. All Rights Reserved.
```

感谢原作者及贡献者；上游 [AUTHORS](https://github.com/google/xpaf/blob/036b52956bc4d52dcff404478ba73fa6a2d0fe47/AUTHORS) 和 [CONTRIBUTORS](https://github.com/google/xpaf/blob/036b52956bc4d52dcff404478ba73fa6a2d0fe47/CONTRIBUTORS) 分别列出 `opensource@google.com` 和 Adam Sadovsky。

来源核对参照上游提交 [`036b529`](https://github.com/google/xpaf/tree/036b52956bc4d52dcff404478ba73fa6a2d0fe47/chrome)：原扩展包的 HTML/CSS 等文件与该提交对应，JavaScript 另含严格模式声明，清单另含商店更新地址；本项目不声称原扩展包与整个上游目录逐字相同。

原作者及贡献者的声明保留在源文件中，修改过的 JavaScript 文件附有修改说明，清单中的描述注明非官方 MV3 适配身份。完整许可证见 [LICENSE.txt](LICENSE.txt)，来源及修改记录见 [NOTICE.txt](NOTICE.txt) 和 [CHANGELOG.md](CHANGELOG.md)。

本项目新增的说明、测试及几何图标也按 Apache-2.0 提供。许可证不代表原作者或 Google 对本改版的认可或背书。
