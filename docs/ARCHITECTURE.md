# web-paperize V0.1 架构

> 依据：`docs/REFERENCE_IMPLEMENTATION_ASSESSMENT.md` 的采纳决定。
> 范围：V0.1 = 「当前标签页 → 矢量 PDF」，Text 模式单引擎。

## 1. 总体数据流

```
用户点击 popup「Save as PDF」（用户手势，同时授 activeTab）
  ↓ runtime.sendMessage({action:'capture', overrides})
[service worker]
  ↓ cdp.withDebugger(tabId, …)             # 引用计数 + try/finally detach
  ├─ zoom 归一化：originalZoom/zoomSettings = tabs.getZoom(s)；≠100% 时先
  │    setZoomSettings({scope:'per-tab'})（Chrome 默认 per-origin，会波及同源其他 tab）
  │    再 setZoom(1)；失败即报错提示用户手动设 100%
  │    （2026-09-10 实测：150% 下 MDN 8→13 页、vscode 2→4 页，缩放会泄漏进 printToPDF）
  ├─ Emulation.setEmulatedMedia({media:'screen', features:[reduced-motion]})
  ├─ prepare：primePage → declutter → expand → applyPrintCss   # 全程记 undo log
  ├─ 量取 contentWidth/contentHeight（三重测量取最大）
  ├─ 横向溢出时：视口定点迭代（setDeviceMetricsOverride 撑宽至文档宽度收敛）
  ├─ 计算 paper/scale/margin（fitWidth：computeFitScale 带 2% 宽度余量）
  ├─ Page.printToPDF({ transferMode:'ReturnAsStream', … })（仅参数不兼容错误才删 generateTaggedPDF 重试）
  ├─ IO.read 流式读取 → Uint8Array
  └─ finally：restorePage（逆序 undo）→ media 复位 → clear 视口覆盖
       → setZoom(originalZoom) → setZoomSettings(原值) → detach
[download]
  ↓ offscreen document 铸 blob URL（失败兜底 data: URL）
  ↓ chrome.downloads.download({filename:'{title}.pdf'})
  ↓ onChanged complete/interrupted → revoke blob URL
```

进度反馈：popup（打开时）+ 扩展 badge（`… / OK / ERR`）。错误分类见 §6。

## 2. 目录结构

```
web-paperize/
├── manifest.json
├── src/
│   ├── background/
│   │   ├── service-worker.js   # 入口：消息路由、busyTabs、权限请求、进度/错误分发
│   │   ├── cdp.js              # chrome.debugger 封装（引用计数/withDebugger/CdpError/readStream）
│   │   ├── capture.js          # capturePage(tabId, settings)：编排 prepare→print→teardown
│   │   ├── prepare.js          # 注入页面的函数库（每个函数自包含，可被 executeScript 序列化）
│   │   ├── settings.js         # storage.local：defaults + 读取/缓存
│   │   └── download.js         # offscreen blob URL、文件名模板、保存
│   ├── popup/
│   │   ├── popup.html/js/css   # V0.1 唯一 UI：Paper/Layout/Margin + Save 按钮 + 进度
│   └── offscreen/
│       ├── offscreen.html/js   # makeBlobUrl / revokeBlobUrl
├── docs/
└── tests/                      # 静态语法检查脚本 + 手工 benchmark 页清单（见 V0.1_SCOPE）
```

无构建步骤：纯 ES modules，`chrome://extensions → Load unpacked` 直接加载。这也意味着 `prepare.js` 中被 `executeScript({func})` 序列化的函数**必须自包含**（无 import、无闭包引用），跨注入状态挂在 ISOLATED world 的 `window.__wpz__` 上——这是 page2pdf 验证过的约束。

## 3. 模块契约

### 3.1 cdp.js
- `attach(tabId)` / `detach(tabId)`：引用计数；`withDebugger(tabId, fn)` 保证 finally detach。
- `send(tabId, method, params)`：promise 化 `chrome.debugger.sendCommand`，失败抛 `CdpError`。
- `readStream(tabId, handle)`：`IO.read`（1 MiB 块）读到 eof，`IO.close` 收尾。
- attach 失败翻译：已连 DevTools / 受限页面（chrome://、Web Store）→ 用户可读文案。

### 3.2 prepare.js（全部在页面 ISOLATED world 执行）
- `window.__wpz__ = { undo: [], record, injected: [], pickedElement: null }`。
- `record(el, prop, isAttr)`：记录 {el, prop, isAttr, prev, priority} —— 恢复的唯一事实源。
- `primePage({scrollThrough})`：解锁 body 滚动锁（modal 打开时的 overflow:hidden）→ lazy→eager + data-* 回退 → 逐步滚动（90% 视口高步长，≤400 步，60ms/步，4 倍暴涨熔断）→ 回原位 → 等图（6s/图超时）→ `fonts.ready`（3s 竞速）→ 双 rAF。
- `declutterPage()`：噪声词隐藏 → 覆盖 ≥80%×70% 或 dialog 隐藏 → 其余 fixed/sticky 改 static → 高 z-index backdrop 隐藏。
- `expandContent()`：`<details>` 全开；纵向滚动容器展开（跳过 >20000px）；横向滚动容器（`overflow-x: auto|scroll`）一并展开，使宽表格把文档撑宽、由整页 fitWidth 缩小兜底（`<pre>` 例外：改走 pre-wrap 换行）。
- `applyPrintCss(css)`：动画暂停 / `print-color-adjust: exact` / 隐藏滚动条 / `pre` 强制 `pre-wrap + overflow-wrap: anywhere`（纸张没有横向滚动，长代码行换行而非截断）+ 分页友好规则（break-inside avoid、thead 重复）。
- `measurePage()`：宽高各三重测量取最大 + title/url/host/dpr。
- `restorePage()`：移除注入节点与 style → 逆序 undo → 清掉因此变空的 `style` 属性 → 回滚滚动位置。
- 每个函数**幂等可重入**；`restorePage` 对元素已消失逐条容错。

**恢复契约**：插件**主动施加**的 DOM/style/attribute/scroll/`<details>` 修改，必须全部经 undo log 恢复；预滚动触发的页面自身 JS 副作用（lazy 内容已加载、infinite scroll DOM 增长等）不承诺回滚。所有属性变更一律走 `record()`（含 `img.decoding`——page2pdf 存在未记录该属性导致恢复缺失的缺陷，不继承）。

### 3.3 capture.js
- `capturePage(tabId, settings, {onProgress})`，整体在 `withDebugger` 内，内层再包 try/finally 调 `teardown`。
- 顺序硬约束（审计 §1.3/§1.4 的 upstream observation）：**改高度的 prepare 全部完成 → 测量 → （实验性 viewport 覆盖，若启用）→ 打印**。
- 居中溢出迭代：横向展开后的宽内容（如宽表格）在更宽的布局里会被 `margin:auto` 容器继续右推（2026-09-10 夹具实测：文档宽度随视口宽度呈 R(v)=v/2+c，差量逐轮减半），单次测量必然欠估、scale 余量救不了。捕获时以 `Emulation.setDeviceMetricsOverride` 逐步撑宽视口至文档宽度收敛（≤8 轮、容差 max(16px, 1%)），以收敛宽度计算 fitWidth 缩放；仅当 scrollWidth > 视口×1.02 时触发，普通页面路径不受影响。
- printToPDF 参数：`printBackground:true, preferCSSPageSize:false, transferMode:'ReturnAsStream', generateTaggedPDF:true`（老版本删参重试）。
- 捕获开始时记录 `location.href`；teardown 前校验未变（防导航后恢复悬空）。

### 3.4 settings.js
- `storage.local` 键：`defaults`（单对象；不用 `storage.sync`，避免设置随 Chrome Sync 离开本机）。V0.1 字段：`paper('a4'|'letter'), orientation('auto'|'portrait'|'landscape'), margin('none'|'slim'|'normal'|'wide'), fitWidth(true), printBackground(true), avoidBreaks(true), declutter(true), expandScrollers(true), filenameTemplate('{title}')`。
- 内存缓存 + `storage.onChanged` 失效。preset（按 host）留 V0.3，schema 预留。

### 3.5 download.js + offscreen
- `buildFilename(template, metrics)`：宏 `{title}/{host}/{domain}/{date}/{time}/{path}` + 非法字符清洗 + 120 字符截断。
- `savePdf(bytes, {filename, saveAs})`：offscreen（`reasons:['BLOBS']`，单例防并发）→ blob URL → `chrome.downloads.download` → onChanged 后 revoke；offscreen 失败兜底 data: URL。

### 3.6 service-worker.js
- `busyTabs: Set<number>`；同 tab 重复触发 → 明确报错。
- 消息协议（`{action, …}`，响应统一 `{ok, result|message}`）：
  - `getState` → {settings, tab:{id,title,url,capturable}, busy}
  - `capture` {overrides} → 执行并回 {filename, size, title, url}
  - `progress`（SW→popup 单向）→ {text, progress}
- `chrome.debugger.onDetach`（用户点掉调试条）→ 仅标记该 tab 为外部 detach（供错误文案与短路判断）；**不清 busyTabs**——busy 状态只能由 `runCapture` 最外层 finally 清除，避免旧捕获还在 teardown 时放进第二次捕获。

### 3.7 popup
- 打开即 `getState`；受限页面禁用 Save 并说明原因（debugger 为安装时声明的 required 权限，无运行时请求流程）。
- 捕获期间监听 progress 更新进度条；完成显示文件名与大小；错误显示分类文案。
- 受限页面（chrome:// 等）禁用 Save 并说明原因。

## 4. 权限与隐私

```json
"permissions": ["activeTab", "scripting", "downloads", "storage", "offscreen", "debugger"]
```

- **无 host_permissions、无 optional_permissions**：捕获由 popup 点击发起，activeTab 授权当前 tab 足够（比 page2pdf 的 `<all_urls>` 更克制）。
- `debugger` 为 manifest **required** 权限：Chrome 当前官方规范不允许其出现在 `optional_permissions`（pdfsnap 的 optional 方案属参考项目实现、与规范冲突，不采纳）。因此安装时即声明；运行时没有 permissions.request / debuggerGranted / revoke 流程，popup 不做相关状态。
- 捕获期间 Chrome 顶部出现"正在调试"提示条属平台行为，无法去除；代码必须保证最短 attach 时间并在一切异常路径 detach。
- 纯本地：无网络请求、无遥测、不上传任何页面内容。

## 5. 错误处理原则（审计归纳）

1. debugger 的 detach 是最高优先级 finally；清理步骤**逐一容错**，任何一步失败不影响已产出结果与后续步骤。
2. 恢复页面（undo log 逆序）与 media/viewport 复位在**同一 finally 链**内，即使 printToPDF 抛错也执行。
3. 用户可读错误分类：① DevTools 已连接；② 受限页面；③ 该 tab 正在导出；④ 页面无内容/导航中断；⑤ 打印引擎失败（原始信息附后）；⑥ 捕获中 debugger 被外部 detach（按 onDetach reason 区分：tab 被关闭 / 调试条被点掉 / DevTools 接管）；⑦ zoom 归一化失败（提示手动设 100%）。
4. badge 错误态 4s 后自动清除；busyTabs 永远在 finally 中移除。

## 6. 测试策略（V0.1）

- 自动化（Node，无浏览器）：`node --test` 对 `buildFilename`/`paperInches`/`marginInches`/`sanitizeFilename` 等纯函数跑单测；`prepare.js` 函数做语法自包含检查（new Function 序列化不抛错）。
- 确定性本地回归：`tests/fixtures/benchmark.html`（离线、无网络依赖，覆盖 sticky/fixed、overlay、details、内部滚动、lazy 图、宽 table/pre、中文、背景、链接），先验证 prepare/restore 层与打印效果。
- 手工 benchmark：`docs/V0.1_SCOPE.md` §4 的页面矩阵 × Page to PDF A/B 对照，逐项打勾留档（截图放 `docs/benchmark/`，gitignore 大文件）。

## 7. 演进预留（不在 V0.1 实现）

- V0.2：snapshot 双引擎（借鉴 page2pdf `pdf-writer.js`）、元素/选区导出（picker + isolateElement 模式）、单张连续长页（测量法 + 200in 上限 + 二分兜底）、HUD 进度药丸、页眉页脚模板。
- 后续（历史 V0.3 roadmap，部分已由 Case #2 超越）：网站 preset（`presets[host]`）与批量/后台导出仍在候选；readability Article Mode 已由 Paperized 布局（附录 A/B）落地，不再单列。

---

# 附录 A：双引擎架构（Case #2 G1 Landing，2026-09-14）

V0.2.1 之后新增第二条渲染引擎。两条引擎共存，入口为 `capturePage(tabId, settings, { layout })`：

## A.1 两条引擎

**Original Web Layout**（默认，`layout` 未指定）
- 保留原网页视觉布局，打印的就是屏幕上看到的排版。
- 适合 repo/dashboard/首页/web app 等布局型页面。
- 既有管线（prime → declutter → expand → print CSS → printToPDF）不变。

**Paperized Layout**（`layout: 'paperized'`，G1/G1.1/G1.2 FINAL PASS）
- 面向阅读型文章：正文提取 → 归一化 → 自有 Paper 文档 → 自有排版。
- 管线：prime lazy → extract（Readability on clone + 结构交叉诊断）→ normalize（媒体 URL/净化/标题保真/尾部剪除）→ materialize（Shadow DOM owned document + Paper CSS）→ print state（源页面完全不可见）→ region 感知 A4 → Page.printToPDF → restore。
- 模块：`paper-page.js`（页面侧函数，序列化注入，与 prepare.js 同契约）、`paper-css.js`（排版契约）、`paperize.js`（编排）、`vendor/readability/`（Apache-2.0）。

## A.2 引擎不变量

1. Paperized 永不打印 source DOM——打印画布上只有 owned Paper host 可见。
2. source page 在 print state 完全隔离（结构性规则，非 class/id 猜测）。
3. html/body 的 width+min-width 必须保持在打印视口内，否则触发引擎级 shrink-to-fit（见 A.3/F-7）。
4. 原站 class/style 不得控制 Paper typography——Paper CSS 是唯一排版来源。
5. title 不可靠时允许为空，不伪造（不拿正文首段冒充标题）。
6. 尾部剪除必须高置信、保守：纯图尾段仅在出现文章结束标记（参考资料/references/结语等）后才剪；CTA 短文本块需命中通用关键词。
7. Original 永远是安全 fallback。

## A.3 引擎事实 F-7（Chromium printToPDF shrink-to-fit）

当文档布局宽度超过纸宽/视口约束时，`Page.printToPDF` 会对**整页**施加一层额外缩放（无视 scale 参数）。实测：body `min-width:1160px` 的页面在 A4（794px 视口）下被缩至 0.68×，表现为字号与正文列同步异常变小（Case #2 G1 的 CSDN 8pt/318pt 现象）。防御：打印态清零 html/body 的 min-width/max-width，并保证文档宽 ≤ 纸宽。

---

# 附录 B：Auto Paperize Detector（Case #2 G2/G2.1 Landing，2026-09-14）

G2 detector 层已落地为**内部能力**（`src/background/paper-detect.js`），尚未接入 Auto runtime / UI：

```
Auto candidate（未来）
    ↓
detectPaperizable(signals)
    ├─ 8 项门全过 → paperized / high
    └─ 任一项失败 → original / low   ← Auto 的安全默认
```

**核心哲学：False Paperize 优先级高于 Missed Paperize。** 宁可保守回 Original，不错误重构 dashboard/feed/产品页。

## 八项门控（全 AND；isProbablyReaderable 仅 supporting note，不作硬门——微信假阴性实证）

1. readability-parse；2. text-substantial（≥700 字符）；3. subject-size-agreement（scorer/readability 体量比 ≤3×）；4. subject-text-overlap（前/中/尾 3 个叶级 prose 锚点 ≥1 个出现在 structural root 文本中，空白不敏感包含）；5. content-prose（提取内容 prose 块 ≥4）；6. content-link-density（提取内容链接密度 ≤0.34）；7. not-a-link-shell（文档链接密度 ≤0.9）；8. subject-landmark-or-coverage（语义地标 或 提取覆盖 ≥15%）。

阈值集中在 `THRESHOLDS` 常量（含数据出处注释）。主信号取**提取内容级**而非文档级（文档级被站点外壳污染：实测 CSDN/MDN/Wiki 文档链接密度 0.5-0.7 而正文 0.05-0.3）。

## Benchmark 汇总（24 页 Golden Set，2026-09-14，快照存于 owner 本地研究档案，不入库）

| 类别 | 结果 |
|---|---|
| positive（明确应 Paperize） | 10/11 |
| negative（明确应 Original） | 7/7（False Paperize = 0） |
| ambiguous（Auto 应回 Original） | 4/6 |
| strict overall | 21/24 |

关键边界案例：
- **173 字维基 stub → 保守 Original**（text ≥700 的保守代价，非失败）；
- **README-heavy GitHub repo ×2 → 通过全部八门**：README 主导页面文本，是 documented product ambiguity 而非 detector bug——"强阅读主体优先 vs 应用页面优先 Original"属 Auto 产品策略决策，禁止用 hostname/repo 特判解决；
- **Apple 产品页（其余门全过）被 subject-text-overlap=0 单独拦下**——主体一致检查的必要性实证。

## 检测接口（只读）

extractPaperArticle 的 diagnostics 新增 `contentStats`（提取内容 text/linkDensity/proseBlocks）、`subjectOverlap`（锚点+命中）、`scorer.rootText`——全部在 sanitize/prune 之后计算，只增加观测信息，不改变 Paper model 输出（确定性回归见 paper-detect.test.mjs）。

## TODO（遗留，非阻塞）

- Paperized 纸张契约：A4/Letter、portrait、paginated（不支持 Fit/Continuous/landscape）——已在本轮 Auto Productization 实现并固化于 popup 兼容逻辑。
- paperize extract 的 console.log 收敛为 debug 开关。（原"老 V0.3 roadmap 过时"项已在正文清理。）

---

# 附录 C：Auto 产品化（Case #2 收官，2026-09-14）

Whole Page 默认 **Layout: Auto（content-first）**：detector HIGH → Paperized；LOW → Original。README 主导的 repo 等 mixed 页面按 v1 策略允许 Paperized（detector 已证明强单一阅读主体；用户需要完整 UI 时显式选 Original，不做 hostname 特判）。

## 引擎优先级

```
Element / Selection → 既有路径（不进 detector）
Whole Page:
  专用 Adapter（如 ChatGPT）且未 forceGeneric → Adapter（V0.2.1 行为不变）
  否则 layoutMode: auto | paperized | original
    auto      → Detector（与 Paperized 提取共用同一次计算）
    paperized → Paperized（失败直接报错，不静默回退）
    original  → Original
```

## Auto fallback 分类

仅"Paperized 内部失败且捕获仍健康"才安全回退 Original（嵌套 finally 已完整还原页面）。终态不回退：target_closed、canceled_by_user、外部 detach、捕获中导航。

## 结果可见性

每次导出 metrics 携带 requestedLayout / actualLayout / autoDecision / autoFallback；popup 状态行显示 `Saved xxx.pdf · Paperized / Original / Original (Auto fallback)`。日常使用即 G2 的真实 Golden Set。

## Paperized 纸张契约（正式）

A4/Letter、portrait、paginated。不支持 Fit/Continuous/landscape——forced Paperized 时 popup 禁用不兼容控件并提示；Auto 下这些控件保持可编辑（Original 兜底仍会用到）。
