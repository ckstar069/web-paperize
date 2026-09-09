# web-paperize

本地优先的 Chrome 扩展：把当前网页导出为高质量**矢量 PDF**——文字可选中、可搜索、链接可点击，排版尽量还原屏幕所见。

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
  ↓ restorePage（完整恢复导出前的页面状态）
```

纯本地处理，无服务器、无遥测。

## 状态

研究阶段已完成第一轮参考实现审计，进入 V0.1 实现。

- [docs/REFERENCE_IMPLEMENTATION_ASSESSMENT.md](docs/REFERENCE_IMPLEMENTATION_ASSESSMENT.md) — 四个参考项目的逐能力评估与代码血缘台账
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — V0.1 架构（模块契约、数据流、权限模型）
- [docs/V0.1_SCOPE.md](docs/V0.1_SCOPE.md) — V0.1 功能范围与 A/B 验收标准

参考项目：


| 项目 | License | 用途 |
| --- | --- | --- |
| [guillesotelo/page2pdf](https://github.com/guillesotelo/page2pdf) | MIT | 主实现参考 |
| [ictrobot/chrome-debug-screen-to-pdf](https://github.com/ictrobot/chrome-debug-screen-to-pdf) | MIT | 最小 CDP 基线 |
| [Bubu89/full-page-pdf-snap](https://github.com/Bubu89/full-page-pdf-snap) | MIT | 长页 / 权限设计参考 |
| [mozilla/readability](https://github.com/mozilla/readability) | Apache-2.0 | Article Mode（后期） |
| [gildas-lormeau/SingleFile](https://github.com/gildas-lormeau/singlefile) | AGPL | 仅思路参考，不引入代码 |

验收标准：与 Page to PDF 做 A/B benchmark——内容完整、无重复 sticky header、内部滚动不截断、中文字体正常、文字可选可搜、链接可点、导出后页面完全恢复。

## License

MIT（见 [LICENSE](LICENSE)；上游血缘与致谢见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）。
