# Third-Party Notices

web-paperize 自身为 MIT（见根目录 `LICENSE`）。本文件登记上游项目的使用方式与义务；
**任何上游代码在实际复制或 substantial reuse 之前，必须先在此登记条目。**

## guillesotelo/page2pdf — MIT

Copyright (c) 2026 Guillermo Sotelo · <https://github.com/guillesotelo/page2pdf>

使用方式：结构级借鉴 + 部分函数重写（cdp 会话管理设计、undo-log 页面预处理管线、
offscreen blob URL 下载方案、分页友好 CSS 规则）。重写而非逐字复制；仍在源码与
文档中以本条目致谢。若未来出现逐字复制，须在此追加完整 MIT 许可文本。

## Bubu89/full-page-pdf-snap — MIT

Copyright (c) 2026 Bubu89 · <https://github.com/Bubu89/full-page-pdf-snap>

使用方式：仅知识采纳，无代码复制。贡献的 upstream observation（未经本项目独立验证
前不作定论）：标签页 zoom 参与视口计算、打印前 viewport 需覆盖为文档全高、单张纸
高度上限、三重测量取最大值、A4 分页用真实纸张尺寸且不带 pageRanges。其
optional-debugger 权限方案与当前 Chrome 官方规范冲突，未采纳。

## ictrobot/chrome-debug-screen-to-pdf — MIT

Copyright (c) 2025 Ethan Jones · <https://github.com/ictrobot/chrome-debug-screen-to-pdf>

使用方式：仅知识采纳，无代码复制（最小 CDP 路径验证；单页模式二分搜索与
break 重置 CSS 留作 V0.2 参考）。

## mozilla/readability — Apache-2.0（计划 V0.3 vendor，尚未引入）

Mozilla 贡献者 · <https://github.com/mozilla/readability>

计划以 vendor 方式引入 `Readability.js` 与 `Readability-readerable.js`。引入时随附
其 LICENSE 与 NOTICE 于 `vendor/readability/`，并在此更新登记。

## 其他

- SingleFile（AGPL）：仅阅读架构思路，**不引入任何代码**。
- Page to PDF（闭源）：仅作 A/B benchmark 对照对象。
