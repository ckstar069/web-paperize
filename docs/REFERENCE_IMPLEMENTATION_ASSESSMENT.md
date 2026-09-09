# 参考实现评估（Reference Implementation Assessment）

> 审计日期：2026-09-09 · 审计方式：source-level 逐文件阅读（非运行测试）
> 审计对象 commit：审计时各仓库默认分支最新代码；page2pdf 为 v2.0.0（8 commits）

## 0. 结论速览

| 能力域 | 最佳实现 | 我们 V0.1 的决定 |
| --- | --- | --- |
| CDP 会话管理 | **page2pdf** `src/background/cdp.js` | 照该设计重写（MIT，带 attribution） |
| 页面预处理 / 恢复 | **page2pdf** `src/background/prepare.js`（undo log 架构） | 以它为骨架重写，吸收 pdfsnap 的实测修正 |
| Chromium 实测行为事实 | **full-page-pdf-snap** `chrome-mv3/cdp-vektor.js` | 全部采纳进我们的实现细节 |
| 权限模型 | **full-page-pdf-snap**（debugger 走 optional，无 host_permissions） | 采纳，比 page2pdf 更克制 |
| 最小机制验证 | **chrome-debug-screen-to-pdf**（295 行跑通全链路） | 证明核心路径 ~50 行，其余全是附加价值 |
| 矢量 PDF 生成 | `Page.printToPDF`（三者一致） | 唯一路线，无争议 |
| 大文件下载 | **page2pdf** offscreen + blob URL | 采纳（data: URL 作兜底） |
| 分页 A4 | **full-page-pdf-snap**（真实纸张 + 无 pageRanges） | 采纳该模式 |
| 单张连续长页 | screen-to-pdf 二分法 vs page2pdf 测量法 | V0.2 再做，倾向测量法 + 二分法兜底 |
| Snapshot（像素）模式 | **page2pdf** capture.js + pdf-writer.js | V0.2+，零依赖 PDF writer 直接借鉴 |
| Article Mode | **page2pdf / pdfsnap 均自写**；**mozilla/readability** 最成熟 | V0.3 用 readability（vendor 两个文件） |
| 文件命名 / 设置存储 | page2pdf settings.js / download.js | 采纳模板机制与 sync 存储 schema |

各项目整体评价：

- **guillesotelo/page2pdf**（MIT，v2.0.0）：与我们目标重合度最高的主参考。v1→v2 重写删除了 2.4 MB 的 html2canvas/jsPDF，完整实现了 prepare→capture→restore 管线，代码质量高（注释解释"为什么"）。弱点：`host_permissions: <all_urls>` + 安装即要 `debugger`；text 模式未处理标签页缩放（见 §2 zoom）；项目很新（8 commits），未经大规模用户验证——**我们是"提取优秀实现重构"，不是 fork**。
- **ictrobot/chrome-debug-screen-to-pdf**（MIT）：最小真值基线。核心机制只占 ~50 行，验证了路线成立。无任何页面预处理，下载走 data: URL。独有价值：单页模式二分搜索 + `break-*` 重置 CSS。
- **Bubu89/full-page-pdf-snap**（MIT）：主路线是滚动截图拼接（Firefox MV2 起家，Chrome MV3 为脚本化移植），矢量 CDP 是后加的 `cdp-vektor.js`（534 行）。**代码里沉淀了大量实测得到的 Chromium 行为事实**（缩放、viewport 高度、800 英寸上限、测量时机），是其最大价值；权限设计（debugger optional、零 host_permissions）也是四者中最佳。弱点：德语标识符、image-first 架构、代码是跨浏览器机械移植，直接复用价值低于其注释里的知识。
- **mozilla/readability**（Apache-2.0，v0.6.0）：零运行时依赖，浏览器内只需 vendor `Readability.js`（2812 行）+ `Readability-readerable.js`。API：`new Readability(document.cloneNode(true), options).parse()`。注意：会改变传入文档（必须传克隆）；评分正则带拉丁文习惯（逗号密度），中文页效果需实测；`charThreshold` 默认 500 对中文偏严，可调。

## 1. 逐能力对比矩阵

### 1.1 CDP 会话管理（attach / detach / 恢复）

| 项目 | 做法 | 评价 |
| --- | --- | --- |
| page2pdf | 引用计数 attach（嵌套操作不会提前 detach）；`withDebugger` try/finally；`CdpError.recoverable`；attach 失败原因翻译（DevTools 已打开 / chrome:// 页面）；`onDetach` 事件清理 busyTabs | **最佳**，产品级 |
| pdfsnap | attach 前后用 `debugger.getTargets()` 查询是否已 attached；finally 中清理步骤逐一 try/catch（"清理错误不得丢弃已生成的 PDF"） | 清理纪律最好 |
| screen-to-pdf | 简单 attach → try/finally → detach（.catch 吞错） | 足够验证机制 |

**采纳**：page2pdf 的 `cdp.js` 设计 + pdfsnap 的"逐一容错清理"原则。

### 1.2 Screen media 与媒体特性

- 三者都用 `Emulation.setEmulatedMedia({ media: 'screen' })`，结束时 `media: ''` 复位——**这是本路线的第一关键步**（pdfsnap 注释：不加则打出的是网站的打印视图，侧栏/导航全部消失）。
- page2pdf 额外传 `features`：`prefers-reduced-motion: reduce`（配合 CSS 暂停动画）与可选 `prefers-color-scheme` 明暗覆盖。**采纳**。

### 1.3 视口 / 缩放 / 测量（Chromium 实测事实，全部来自 pdfsnap 注释）

1. **打印前必须把 viewport 高度覆盖为完整文档高度**（`Emulation.setDeviceMetricsOverride`）：否则 lazy 图片可能空白、`position: sticky` 元素位置错误。且必须**先设置、后打印**，不能边打边设。
2. **标签页缩放必须参与计算**：用户把页面缩放到 150% 时，文档在 CSS 像素下变窄；忽略会导致右侧截断。用 `chrome.tabs.getZoom(tabId)` 取倍率乘到 viewport 尺寸上。⚠️ page2pdf 的 text 模式没做这一步——**这是我们已识别的参考实现缺陷，我们要修**。
3. **文档高度要三重测量取最大值**：`scrollHeight`、`documentElement.getBoundingClientRect().bottom + scrollY`、`body` 同式——绝对定位的页脚、展开的菜单会超出滚动区域。
4. **改变文档高度的操作（declutter、文章模式、宽度覆盖）必须发生在测量之前**，否则纸过高、尾部留白。
5. 单张纸高度上限：pdfsnap 实测 **800 英寸（≈76800 CSS px）** 以上 Chromium 静默失败；page2pdf 自己的常量是 200 英寸；screen-to-pdf 二分上界 1000 英寸。我们取保守值：**200 英寸**，超出转多页。
6. 固定内容宽度（文章模式 reflow）时，**先设宽度、等 reflow（约 250ms）、再量高度**；超宽元素按打印机逻辑裁掉，不跟随。

### 1.4 Lazy-load / 字体 / 图片等待

| 项目 | 做法 |
| --- | --- |
| page2pdf | `loading=lazy`→eager；`decoding=async`→sync；`data-src/data-original/data-lazySrc/data-srcset` 回退提交；iframe lazy→eager；逐步滚动（步长 max(200, 90% 视口高)，上限 400 步，60ms/步，页高 4 倍暴涨且 >200000px 熔断）；滚动后回到原位；逐图等待 load/error（6s 超时）；`document.fonts.ready`（3s 竞速）；双 rAF |
| pdfsnap | 设置全高 viewport 后**跳到底部再跳回顶部**触发 IntersectionObserver（"比任何等待都可靠，且免费"）；lazy→eager；settle 120–400ms；打印前二次测量（页可能已长高） |
| screen-to-pdf | 无 |

**采纳**：page2pdf 的全套（它是唯一处理 `data-*` 惯例和无限滚动的）+ pdfsnap 的"打印前二次测量"修正。V0.1 不做无限流完整加载（到 400 步熔断即止）。

### 1.5 Sticky / Fixed / 遮罩处理

| 项目 | 做法 |
| --- | --- |
| page2pdf | ① id/class 命中 NOISE 词表（cookie/gdpr/onetrust/intercom/…约 30 词）→ 隐藏；② fixed/sticky 且覆盖 ≥80% 宽 ×70% 高 → 判定为遮罩 → 隐藏；③ `role=dialog`/`<dialog>` → 隐藏；④ 其余 fixed/sticky → 改 `position: static`（"出现一次而不是每页盖章"）；⑤ 高 z-index 的 backdrop/overlay → 隐藏 |
| pdfsnap | fixed/sticky 一律标 data 属性 + 一条 CSS 隐藏（上限 400 个）——因为它把 viewport 设成全文档高，fixed 本就只出现一次，但会"横在正文中间" |

**采纳**：page2pdf 的分层启发式（噪声词 / 覆盖率 / dialog / unpin）。V0.1 默认开启，且每一步记入 undo log。

### 1.6 内部滚动 / `<details>` / 分页友好 CSS

- page2pdf：`overflow(-y): auto|scroll` 且 `scrollHeight > clientHeight+8` 且 `clientHeight>40` → 展开（`max-height:none; height:auto; overflow:visible`）；`scrollHeight > 20000px` 的跳过（"本来就该滚"，如长代码块）；`<details>` 全部 `open`。
- page2pdf 的打印 CSS（注入一次性 `<style>`）：
  - 基础：暂停所有动画/过渡、`print-color-adjust: exact`、隐藏滚动条；
  - 分页（可选）：`img/svg/video/canvas/figure/table/pre/blockquote/li/tr { break-inside: avoid }`、`h1–h5 { break-after: avoid }`、`thead { display: table-header-group }`（跨页表头重复）。
- screen-to-pdf 反向技巧：单页模式注入 `break-*: auto` **重置**（避免网站 CSS 强制分页）。

**采纳**：page2pdf 全部；"分页友好"作为默认开启的独立开关。

### 1.7 纸张 / 缩放 / 分页策略

| 需求 | 最佳做法 | 出处 |
| --- | --- | --- |
| A4 等标准纸分页 | 真实纸张尺寸 + **不带 `pageRanges`**，让 Chromium 自己在不切行的位置断页（实测 13 页无切行）；打印边距 ≥0.4in（物理打印机裁边） | pdfsnap |
| 桌面宽页 → 纸宽 | `scale = printableWidthPx / contentWidth`，clamp [0.1, 1]；`preferCSSPageSize: false` | page2pdf |
| 纸张=内容宽（fit） | `paper.width = contentWidth/96 + 2×margin`（96 CSS px/in） | page2pdf |
| 单张连续长页 | 测量法：`paperHeight = contentHeight×scale/96 + 2×margin`（1 次 printToPDF）＋ `pageRanges: '1'`；兜底二分法：以 `/Type /Page` 正则数页数，16 轮二分纸张高度 | page2pdf / screen-to-pdf |
| 老版本兼容 | `generateTaggedPDF`、`generateDocumentOutline` 老 Chromium 报错 → 删参重试 | page2pdf / pdfsnap（各自独立发现） |

**采纳**：如上全部。V0.1 只做 A4/Letter 分页 + fitWidth；连续长页留 V0.2（测量法为主）。

### 1.8 PDF 传输与下载

- 传输：`transferMode: 'ReturnAsStream'` + `IO.read`（1MB 块）流式读取（page2pdf）＞ base64 直返。**采纳流式**。
- 下载：MV3 service worker 无 `URL.createObjectURL` → **offscreen document（reasons: ['BLOBS']）铸造 blob URL**；失败兜底 `data:application/pdf;base64`；`chrome.downloads.onChanged` 在 complete/interrupted 后 revoke。附：Firefox 拒绝 `data:` URL 下载（pdfsnap 实测）——仅影响跨浏览器，Chrome 无碍。**采纳 page2pdf 方案**。
- 文件名：模板 `{title}/{host}/{domain}/{date}/{time}/{path}` + 清洗（去非法字符、120 字符截断）+ 可选子文件夹。**采纳**。

### 1.9 权限模型（三家对比）

| 项目 | 安装时权限 | host_permissions | 评价 |
| --- | --- | --- | --- |
| page2pdf | debugger, scripting, storage, downloads, contextMenus, offscreen, tabs, activeTab | `<all_urls>` | 功能最全，隐私声明最难解释 |
| pdfsnap | activeTab, downloads(+open), storage, contextMenus, notifications, scripting；**debugger 为 optional** | **无** | **最佳**：走图片路线的用户安装时零警告；debugger 在用户开启矢量模式时（设置页/弹窗点击=用户手势）再请求 |
| screen-to-pdf | debugger, downloads, tabs | 无 | 最小但安装即要 debugger |

**采纳 pdfsnap 模型**：安装时 `activeTab + scripting + downloads + storage + offscreen`；`debugger` 放 `optional_permissions`，首次点击"导出 PDF"时（popup 内用户手势）`permissions.request`。V0.1 无 host_permissions、无 tabs、无 contextMenus/notifications。

### 1.10 UI / 进度 / 错误反馈

- page2pdf：popup 关闭后进度转移到**页面内 HUD 药丸**（Shadow DOM `:host{all:initial}` 样式隔离）+ 扩展 badge（`.../OK/ERR/i/n`）+ HUD 捕获期间自动隐藏（防止拍进 PDF）。
- pdfsnap：badge + i18n（10 语言）+ result 页。
- 错误信息翻译成用户语言是 page2pdf 强项：DevTools 已连接、chrome:// 不可读、页面正在保存中、无选区等。

**采纳**：V0.1 用 badge + popup 内进度（HUD 药丸是好设计，留 V0.1.1/V0.2）；错误文案照 page2pdf 的分类翻译。

### 1.11 并发 / 状态保护

- page2pdf：`busyTabs` Set 保证每 tab 一次捕获；`chrome.debugger.onDetach`（用户手动点"取消调试"）时清理状态。
- 我们补充的改进点（参考实现均未做）：捕获开始时记录 `document URL`，恢复前校验，防止捕获期间页面导航导致 undo log 悬空（导航后 isolated world 已销毁，注入会静默失败——可接受，但要记日志）。

### 1.12 Snapshot（像素）模式（V0.2+ 预研）

- page2pdf：按纸张纵横比算切片高 → `Page.captureScreenshot({ captureBeyondViewport: true, clip: {x,y,w,h,scale} })` → 尺寸受合成器纹理上限 16000px 约束（超限自动降 scale / 缩切片）→ JPEG 按字节直嵌 PDF（DCTDecode，零重编码）/ PNG 经 OffscreenCanvas 解为 RGB + `CompressionStream('deflate')` → **链接热区映射为 PDF Link 注解**（快照里链接仍可点）。PDF writer 从零手写（~200 行，无任何依赖）。
- pdfsnap 的教训：JS 动作型按钮（复制/缩放/菜单）没有 URL，不能做链接注解，只处理真实 href。
- **结论**：V0.2 直接借鉴 page2pdf 的 `pdf-writer.js` + 切片策略（MIT，attribution）。

### 1.13 Article Mode（V0.3 预研）

- 两个扩展都**没有**用 mozilla/readability，而是自写评分（page2pdf：段落文本评分 + 链接密度 + 向上爬升启发式；pdfsnap：候选选择器 + `textLen×(1+段落数/10)×(1−linkRatio)`）。pdfsap 还记录了两个实战教训：① `document.body` 不能作为候选（它文本量必最大，永远赢）；② 只隐藏不重构（"重组过的节点不能可靠复原"），但隐藏后要**重排版式**（Georgia 衬线、40em 行宽、代码块 pre-wrap），否则"屏幕排版直接印在纸上读不了"。
- **结论**：我们不重复造轮子——vendor `readability` 两个文件（Apache-2.0，NOTICE 保留），输出 HTML 后套我们自己的 print 样式（借鉴 pdfsnap 的排版教训），再走同一 printToPDF 管线。中文页需实测调 `charThreshold`。

## 2. 参考实现已识别缺陷清单（我们要修的）

1. **page2pdf text 模式不处理标签页缩放**（pdfsnap 明证实测后果：右侧截断）。
2. page2pdf 的 `pageRanges` 缺失问题：无（它用测量法）；但它 200in 上限 vs pdfsnap 800in 实测——我们以 200in 保守值规避争议。
3. page2pdf 打印前不重测文档高度（pdfsnap 证明 declutter/展开后高度会变；page2pdf 在 `preparePage` 末尾有 measure，但其 `primePage` 在 declutter 之前——顺序可接受，我们在 teardown 前再校验一次）。
4. pdfsnap 单页超过 800in 直接切多张 800in 巨纸（实用性存疑）；我们超限即转 A4 分页并提示。
5. screen-to-pdf 恒 `saveAs: true`、恒 data: URL——大文件易崩。
6. 所有参考均无"捕获期间页面被导航"的防护（见 §1.11）。

## 3. 代码血缘与许可证台账

| 来源 | 借鉴物 | 方式 | License / 义务 |
| --- | --- | --- | --- |
| page2pdf | cdp.js 会话管理设计；undo log + prepare 管线结构；offscreen 下载方案；pdf-writer.js（V0.2）；HUD/picker（V0.2+ 参考） | **重写为主**，结构级借鉴，少量函数照搬 | MIT——重写也建议在 NOTICE 中致谢 |
| full-page-pdf-snap | §1.3 全部实测事实；A4 分页模式；清理纪律；权限模型 | **知识采纳**，无代码复制 | MIT |
| chrome-debug-screen-to-pdf | 最小机制验证；二分法单页（V0.2 兜底思路）；break 重置 CSS | 知识采纳 | MIT |
| mozilla/readability | Readability.js + readerable.js（V0.3） | **vendor 原文件** | Apache-2.0——保留 LICENSE/NOTICE |
| SingleFile | 无 | 仅思路（AGPL，禁代码） | — |
| Page to PDF | 闭源 | 仅 A/B benchmark 对象 | — |

我们仓库的 License 建议 MIT（与主要参考一致，待用户确认）。
