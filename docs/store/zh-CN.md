# Chrome Web Store 商店文案 - 简体中文

## 名称

Web Paperize

## 简短说明

使用 Chrome 原生渲染将网页内容保存为高质量 PDF。不使用 Web Paperize 服务器，不包含遥测。

## 单一用途声明

将网页内容保存为高质量 PDF 文档。

## 完整说明

Web Paperize 使用 Chrome 的渲染能力，把网页或用户明确选择的网页内容转换成文字可
选择、可搜索的 PDF 文档。

你可以根据页面选择合适的输出方式：

- 自动：可靠的阅读内容使用适合纸张的排版，否则保留原网页布局；
- 纸张化：提取主要阅读内容，整理成清晰的分页文档；
- 原网页：保留网页当前布局；
- 可导出整个页面、一个选定元素或文本选区；
- 在打开的 ChatGPT 会话中主动导出时，可生成完整、适合打印的会话 PDF；
- 界面语言可在 Auto、简体中文和 English 之间切换，不会改变网页或 PDF 正文语言。

PDF 在用户浏览器中生成。Web Paperize 没有开发者后端服务器，也不收集遥测数据。
普通网页导出由 Chrome 在浏览器本地处理。用户主动导出 ChatGPT 完整会话时，扩展使用用户已有的
ChatGPT 登录会话，直接向 ChatGPT/OpenAI 请求该会话，仅用于创建 PDF；开发者不会
收到用户的令牌或会话内容。

Web Paperize 是独立扩展，与 OpenAI 无关联。

## 权限说明

- 活动标签页与脚本：只处理用户要求导出的当前页面；
- 调试器：导出期间短暂调用 Chrome 的 PDF 打印与打印模拟命令，成功或失败后断开；
- 下载：保存 PDF 并报告下载是否完成；
- 存储：保存本地导出偏好和短期待完成下载元数据；
- 离屏文档：为 Chrome 下载创建临时 PDF blob URL；
- 右键菜单：提供页面、选区和元素导出入口。

扩展不申请广泛 host permission，也不会在后台监控浏览活动。

## 支持与已知限制

- 需要 Chrome 118 或更高版本；
- 不能导出 Chrome 内部页面和 Chrome Web Store 页面；
- 暂不支持 iframe 内的文本选区导出；
- ChatGPT 完整会话导出需要用户已登录并打开一个会话；
- PDF 渲染器连接活动标签页期间，Chrome 会显示标准调试提示；
- 单张连续页面受 Chromium 安全 PDF 高度限制，超限时回退为 A4 分页。

隐私政策：
<https://github.com/ckstar069/web-paperize/blob/main/PRIVACY.md>

支持：
<https://github.com/ckstar069/web-paperize/issues>
