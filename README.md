# Web Paperize

本地优先的 Chrome 扩展（Chrome 118+）：把当前网页导出为高质量**矢量 PDF**——文字可选中、可搜索、链接可点击，排版尽量还原屏幕所见。

## 动机

- **Page to PDF**（闭源）：体验标杆，但收费
- **Chrome 自带打印**：受制于网站失修的 `@media print`，排版差、内容丢失
- **html2canvas + jsPDF 重绘**：非浏览器渲染引擎，现代 CSS / Canvas / 跨域图片易失真，明确不采用

## 技术路线

```
当前网页
  ↓ preparePage（lazy-load 预滚动、字体/图片等待、sticky/fixed 处理、内部滚动展开、<details> 展开）
  ↓ chrome.debugger（CDP）
  ↓ Emulation.setEmulatedMedia("screen")   ← 强制 screen CSS，绕过 @media print
  ↓ Page.printToPDF
  ↓ chrome.downloads 保存
  ↓ restorePage（恢复插件主动施加的页面修改）
```

本地处理优先：不使用 Web Paperize 服务器，不包含遥测。普通网页导出由 Chrome 在浏览器本地处理；只有用户主动要求导出 ChatGPT 完整会话时，扩展才会使用现有登录会话直接向 ChatGPT/OpenAI 请求该会话及所需资源。开发者不会收到令牌或导出内容，数据也不会发送给无关第三方。

- [隐私政策 / Privacy Policy](PRIVACY.md)
- [Chrome Web Store 上架准备](docs/STORE_READINESS.md)
- [Chrome Web Store 审核说明](docs/STORE_REVIEW_NOTES.md)

## 状态

V0.2.0 已实现并通过真机验证（2026-09-10，见 [docs/benchmark/2026-09-10/README.md](docs/benchmark/2026-09-10/README.md)）。

当前第一个 Chrome Web Store Release Candidate 使用 `0.2.2`；这是 0.2 系列的上架准备版本，不代表 V0.3 功能阶段。发行包必须通过 `npm run package:store` 从显式白名单生成，不能直接压缩仓库。

- **整页导出**：工具栏图标 → Save as PDF
- **元素导出**：图标 → Pick an element…（或右键）→ 悬停出现紫框（跟随鼠标），**↑/↓ 扩大/缩小选区**，点击导出所选区块
- **选区导出**：选中文字 → 右键 → Save selection as PDF（当前仅支持顶层页面选区；iframe 内选区会明确提示不支持）
- **单张连续长页**：勾选 One continuous page（上限 200in，超限自动回退 A4 分页）
- **中英双语界面**：popup 底部的“界面语言 / Interface language”可选 Auto / 简体中文 / English；Auto 跟随 Chrome 界面语言，选择保存在本机并即时刷新 popup 与右键菜单，且不改变网页或 PDF 内容
- **ChatGPT 完整会话**：在会话页直接 Save as PDF——绕过虚拟化 DOM 从会话接口取全量内容（含引用编号与来源列表、图片内嵌、附件清单）；右键 "Save visible page as PDF" 可导出当前可见内容

- [docs/REFERENCE_IMPLEMENTATION_ASSESSMENT.md](docs/REFERENCE_IMPLEMENTATION_ASSESSMENT.md) — 四个参考项目的逐能力评估与代码血缘台账
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — V0.1 架构（模块契约、数据流、权限模型）
- [docs/V0.1_SCOPE.md](docs/V0.1_SCOPE.md) — V0.1 功能范围与 A/B 验收标准

## 使用（开发模式）

1. `chrome://extensions` → 开启 **Developer mode** → **Load unpacked** → 选择本仓库根目录
2. 打开任意网页 → 点击工具栏图标 → **Save as PDF**
3. 权限说明：`debugger` 为安装时声明（Chrome 规范不允许 optional）；捕获期间 Chrome 顶部会出现"正在调试"提示条，导出完成后自动消失
4. 测试：`npm test`（纯函数单测 + 注入函数自包含检查）；本地基准夹具：`tests/fixtures/benchmark.html`

- [docs/V0.2_PLAN.md](docs/V0.2_PLAN.md) — V0.2 规划（ChatGPT 会话调查、元素/选区导出、连续长页、Snapshot 接口）

参考项目：


| 项目 | License | 用途 |
| --- | --- | --- |
| [guillesotelo/page2pdf](https://github.com/guillesotelo/page2pdf) | MIT | 主实现参考 |
| [ictrobot/chrome-debug-screen-to-pdf](https://github.com/ictrobot/chrome-debug-screen-to-pdf) | MIT | 最小 CDP 基线 |
| [Bubu89/full-page-pdf-snap](https://github.com/Bubu89/full-page-pdf-snap) | MIT | 长页 / 权限设计参考 |
| [mozilla/readability](https://github.com/mozilla/readability) | Apache-2.0 | Article Mode（后期） |
| [gildas-lormeau/SingleFile](https://github.com/gildas-lormeau/singlefile) | AGPL | 仅思路参考，不引入代码 |

验收标准：与 Page to PDF 做 A/B benchmark——内容完整、无重复 sticky header、内部滚动不截断、中文字体正常、文字可选可搜、链接可点、导出后插件主动施加的页面修改全部恢复。

## License

MIT（见 [LICENSE](LICENSE)；上游血缘与致谢见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）。
