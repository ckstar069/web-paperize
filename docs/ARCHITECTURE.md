# web-paperize V0.1 架构

> 依据：`docs/REFERENCE_IMPLEMENTATION_ASSESSMENT.md` 的采纳决定。
> 范围：V0.1 = 「当前标签页 → 矢量 PDF」，Text 模式单引擎。

## 1. 总体数据流

```
用户点击 popup「Save as PDF」（用户手势）
  ↓ permissions.request(debugger)          # 仅首次；已授权则跳过
  ↓ runtime.sendMessage({action:'capture', overrides})
[service worker]
  ↓ cdp.withDebugger(tabId, …)             # 引用计数 + try/finally detach
  ├─ Emulation.setEmulatedMedia({media:'screen', features:[reduced-motion]})
  ├─ prepare：primePage → declutter → expand → applyPrintCss   # 全程记 undo log
  ├─ 量取 contentWidth/contentHeight（三重测量取最大）
  ├─ zoom = tabs.getZoom(tabId)；viewport 覆盖 = 尺寸 × zoom（打印前设好）
  ├─ 计算 paper/scale/margin（fitWidth：scale=printableWidthPx/contentWidth，clamp[0.1,1]）
  ├─ Page.printToPDF({ transferMode:'ReturnAsStream', … })
  ├─ IO.read 流式读取 → Uint8Array
  └─ finally：restorePage（逆序 undo）→ media 复位 → clearDeviceMetricsOverride → detach
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
│   │   ├── settings.js         # storage.sync：defaults + 读取/缓存
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
- `expandContent()`：`<details>` 全开；内部滚动容器展开（跳过 >20000px）。
- `applyPrintCss(css)`：动画暂停 / `print-color-adjust: exact` / 隐藏滚动条 + 分页友好规则（break-inside avoid、thead 重复）。
- `measurePage()`：宽高各三重测量取最大 + title/url/host/dpr。
- `restorePage()`：移除注入节点与 style → 逆序 undo → 清掉因此变空的 `style` 属性（DOM 逐字节还原）。
- 每个函数**幂等可重入**；`restorePage` 对元素已消失逐条容错。

### 3.3 capture.js
- `capturePage(tabId, settings, {onProgress})`，整体在 `withDebugger` 内，内层再包 try/finally 调 `teardown`。
- 顺序硬约束（来自审计 §1.3/§1.4）：**改高度的 prepare 全部完成 → 测量 → 二次测量取 max → 设 viewport（×zoom）→ 打印**。
- printToPDF 参数：`printBackground:true, preferCSSPageSize:false, transferMode:'ReturnAsStream', generateTaggedPDF:true`（老版本删参重试）。
- 捕获开始时记录 `location.href`；teardown 前校验未变（防导航后恢复悬空）。

### 3.4 settings.js
- `storage.sync` 键：`defaults`（单对象）。V0.1 字段：`paper('a4'|'letter'), orientation('portrait'|'landscape'), margin('none'|'slim'|'normal'|'wide'), fitWidth(true), printBackground(true), avoidBreaks(true), declutter(true), expandScrollers(true), filenameTemplate('{title}')`。
- 内存缓存 + `storage.onChanged` 失效。preset（按 host）留 V0.3，schema 预留。

### 3.5 download.js + offscreen
- `buildFilename(template, metrics)`：宏 `{title}/{host}/{domain}/{date}/{time}/{path}` + 非法字符清洗 + 120 字符截断。
- `savePdf(bytes, {filename, saveAs})`：offscreen（`reasons:['BLOBS']`，单例防并发）→ blob URL → `chrome.downloads.download` → onChanged 后 revoke；offscreen 失败兜底 data: URL。

### 3.6 service-worker.js
- `busyTabs: Set<number>`；同 tab 重复触发 → 明确报错。
- 消息协议（`{action, …}`，响应统一 `{ok, result|message}`）：
  - `getState` → {settings, tab:{id,title,url,capturable}, busy, debuggerGranted}
  - `capture` {overrides} → 执行并回 {filename, size, title, url}
  - `progress`（SW→popup 单向）→ {text, progress}
- `chrome.debugger.onDetach`（用户点掉调试条）→ 清 busyTabs。

### 3.7 popup
- 打开即 `getState`；未授权 debugger → Save 按钮触发 `permissions.request`（popup 点击即用户手势）。
- 捕获期间监听 progress 更新进度条；完成显示文件名与大小；错误显示分类文案。
- 受限页面（chrome:// 等）禁用 Save 并说明原因。

## 4. 权限与隐私

```json
"permissions": ["activeTab", "scripting", "downloads", "storage", "offscreen"],
"optional_permissions": ["debugger"]
```

- **无 host_permissions**：捕获由 popup 点击发起，activeTab 授权当前 tab 足够（比 page2pdf 的 `<all_urls>` 更克制，也是 pdfsnap 验证过的模型）。
- debugger 延迟到首次使用请求；拒绝时给出引导文案；可在 popup 内随时 revoke。
- 捕获期间 Chrome 顶部出现"正在调试"提示条属平台行为，无法去除；代码必须保证最短 attach 时间并在一切异常路径 detach。
- 纯本地：无网络请求、无遥测、不上传任何页面内容。

## 5. 错误处理原则（审计归纳）

1. debugger 的 detach 是最高优先级 finally；清理步骤**逐一容错**，任何一步失败不影响已产出结果与后续步骤。
2. 恢复页面（undo log 逆序）与 media/viewport 复位在**同一 finally 链**内，即使 printToPDF 抛错也执行。
3. 用户可读错误分类：① DevTools 已连接；② 受限页面；③ 该 tab 正在导出；④ 页面无内容/导航中断；⑤ 打印引擎失败（原始信息附后）。
4. badge 错误态 4s 后自动清除；busyTabs 永远在 finally 中移除。

## 6. 测试策略（V0.1）

- 自动化（Node，无浏览器）：`node --test` 对 `buildFilename`/`paperInches`/`marginInches`/`sanitizeFilename` 等纯函数跑单测；`prepare.js` 函数做语法自包含检查（new Function 序列化不抛错）。
- 手工 benchmark：`docs/V0.1_SCOPE.md` §4 的页面矩阵 × Page to PDF A/B 对照，逐项打勾留档（截图放 `docs/benchmark/`，gitignore 大文件）。

## 7. 演进预留（不在 V0.1 实现）

- V0.2：snapshot 双引擎（借鉴 page2pdf `pdf-writer.js`）、元素/选区导出（picker + isolateElement 模式）、单张连续长页（测量法 + 200in 上限 + 二分兜底）、HUD 进度药丸、页眉页脚模板。
- V0.3：网站 preset（settings 增加 `presets[host]`）、readability Article Mode（vendor + print 样式）、批量/后台标签页导出（需评估 tabs 权限代价）。
