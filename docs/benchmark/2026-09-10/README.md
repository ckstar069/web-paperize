# 2026-09-10 基准记录（用户真机实测）

zoom 四组实验 + 真实网站矩阵第一轮。原始 PDF 为 ZCode 会话附件，暂存目录已自动清理未能归档；
以下为从 PDF 中提取的客观指标（页数 / 大小 / MediaBox 均为程序化读取）。

## zoom 实验证据（标签页缩放 × printToPDF）

| 页面 | 100% 缩放 | 150% 缩放 | 现象 |
| --- | --- | --- | --- |
| MDN 正则表达式（中文） | **8 页**，1207 KB | **13 页**，1232 KB | 150% 内容撑满 A4、左右黑边 |
| GitHub microsoft/vscode | **2 页**，931 KB | **4 页**，964 KB | 150% 首页文件列表跳到第二页 |

结论：标签页缩放会泄漏进 printToPDF——150% 时 CSS 视口变窄、整页重排、分页漂移。
定稿：捕获前 `chrome.tabs.setZoom(tabId, 1)` 归一化，捕获后恢复原缩放（见 V0.1_SCOPE §1.1 第 17 项）。

## benchmark.html 首轮（修复前）

- 超宽代码块截断 → 已修（pre-wrap 换行，7357358）
- 宽表格截断 → 根因：`overflow-x:auto` 容器未展开（7357358 修复）+ fitWidth 零容差临界值（本轮再加 2% 宽度余量）

## benchmark.html 第二轮（zoom 修复后，表格仍截断）

第二轮确认 zoom 归一化生效（MDN/vscode 100% 与 150% 输出完全一致），但表格右缘仍截断——排除 scale 临界值理论，实测定位真正根因：

**居中溢出**：表格展开后其容器 `<main style="max-width:900; margin:auto">` 随布局变宽继续右推表格。夹具实测（resize_page 逐档）：视口 1185→文档 1755；1755→2040；2040→2182；2182→2253——差量 570→285→142→71 **逐轮精确减半**（R(v)=v/2+c，不动点≈2325）。打印布局（~1797）< 表格右缘（2068），无论 scale 留多少余量都被切。

修复：**视口定点迭代**——检测横向溢出时用 `setDeviceMetricsOverride` 逐步撑宽视口至文档宽度收敛（≤8 轮），以收敛宽度计算缩放；普通页面（无横向溢出）路径不变。

## benchmark.html 第三轮（0e69bc8，用户确认通过）

宽表格完整展示于 PDF 中（整页等比缩小、右缘无截断）。至此本页全部考察项通过：
sticky 只出现一次、cookie 遮罩移除、details 展开、内部滚动展开、lazy 图片加载、
宽表格完整、宽代码换行、中文/背景/链接正常、导出后页面恢复。

**V0.1 首批基准节点收口（2026-09-10）**：本地夹具 ✓；**普通网页矩阵 ✓**（MDN/GitHub/中文长文/维基）；zoom 四组 ✓（100%/150% 输出一致）。ChatGPT 属虚拟化/窗口化 DOM 页面，为 V0.1 不支持类别（V0.1_SCOPE §5），不计入通过判定。GitHub 集中审核已通过（2026-09-10）。

## V0.1 hardening（审核后，2026-09-10）

GitHub 集中审核通过后按工作单执行一轮 hardening（8 项）：zoom 归一化改临时 per-tab
作用域（修复 per-origin 副作用）且失败不静默；print style 所有权改节点引用（不再以
DOM id 认领）；长列表 Y 轴保护不被横向展开旁路；printToPDF 仅在参数不兼容错误时重试；
settings 改 storage.local；harness 路径/lazy 选择器/注释修正；三份文档同步到代码现状
（虚拟化 DOM 正式划出范围）；THIRD_PARTY_NOTICES 纳入 page2pdf 完整 MIT notice。
浏览器 harness 复验：decoy style 存活、Y 保护生效、宽度往返一致（17 项单测全过）。

**已人工验证**（H1 附带要求，2026-09-10 用户确认）：同 origin 双标签页导出期间与
结束后，另一标签页缩放始终保持 150% 不变。

## 测试环境

| 项 | 值 |
| --- | --- |
| OS | macOS（Apple Silicon，darwin 25.6.0） |
| Chrome | 版本待补（测试者可于 chrome://version 查看） |
| 扩展 | web-paperize 0.1.0，Load unpacked |

测试 URL：

- 本地夹具：`tests/fixtures/benchmark.html`（file://）
- MDN：<https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide/Regular_expressions>
- GitHub：<https://github.com/microsoft/vscode>
- 中文长文：<https://www.ruanyifeng.com/blog/2019/09/curl-reference.html>
- 维基：<https://zh.wikipedia.org/wiki/人工智能>
- ChatGPT：用户自有长会话（虚拟化 DOM 不支持类别）

## 真实网站矩阵

| 页面 | 结果 |
| --- | --- |
| MDN 正则表达式（中文） | ✅ 通过 |
| GitHub microsoft/vscode | ✅ 通过 |
| 阮一峰 curl 教程（中文长文） | ✅ 通过 |
| 维基百科「人工智能」 | ✅ 内容完整；4.7 MB、耗时略长（可接受，V0.2 优化项） |
| ChatGPT 长会话 | ❌ 已知限制：虚拟化会话历史消息离屏即从 DOM 卸载；停留最新处导出 = 6 页（仅尾部），手动跳顶等待后导出 = 1 页（DOM 被骨架/卸载替换）。V0.2 调研 |
| 内部后台页 | 跳过（无样本；夹具已覆盖该场景） |

## V0.2.0 真机验证（2026-09-10 晚，用户确认）

| 功能 | 结果 |
| --- | --- |
| 单张连续长页（tall-pages 150in 单页 / 250in 自动分页） | ✅ |
| 元素导出（GitHub About 区块，四轮修复后） | ✅ |
| 选区导出（V2EX ✅；知乎场景已加页数校验自动分页兜底，待复验） | ✅* |
| 整页导出回归（含 About 侧栏，content-visibility 修复生效） | ✅ |

元素导出 About 缺失的四层根因链（均为引擎/站点机制级发现，commit 6644b77→fadd21a）：

1. picker 默认拾取最深层行内元素 → blockFor 爬升到首个内容区块（675b659）
2. Chromium 打印管线跳过 content-visibility:auto 子树 → 全局 visible 反制（23ff1c7，V0.1 整页路径同样受益）
3. picker 根元素返回 + "保持较大选区"守卫锁死整页 + 二次会话 UI 逃逸进打印 → 根因修复 + data-wpz-ui 打印屏蔽（a544e72 / bc1150c）
4. GitHub About 带 Primer hide-sm/md（窄屏响应式迁移隐藏），窄纸打印视口触发移动断点 → 单页模式 un-hide 反制（fadd21a，真实标签页 DOM 快照离线复现验证）

诊断通道沉淀：[wpz] measure（region/documentWidth 分列）+ [wpz] picked 日志 + AppleScript 登录态标签页只读探针/快照取证。
