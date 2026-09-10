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
- V0.3：网站 preset（settings 增加 `presets[host]`）、readability Article Mode（vendor + print 样式）、批量/后台标签页导出（需评估 tabs 权限代价）。
