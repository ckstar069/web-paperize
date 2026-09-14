# Vendored: Mozilla Readability

- Package: `@mozilla/readability` npm 0.6.0（tarball 原样复制，未修改）
- Files: `Readability.js`, `Readability-readerable.js`, `LICENSE.md`（Apache-2.0）
- Upstream: https://github.com/mozilla/readability
- Version pin rationale: 与 Case #2 research benchmark（2026-09-12）所测版本一致。
- Usage: Chrome MV3 扩展中以 classic script 注入页面隔离世界
  （`chrome.scripting.executeScript({files})`），`Readability.parse()` 运行于
  `document.cloneNode(true)` 上，源页面不被提取过程修改。
- 修改记录：无（如未来需要补丁，在本文件登记 diff 与理由）。
