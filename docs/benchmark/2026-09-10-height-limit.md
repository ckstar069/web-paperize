# 单张连续长页高度上限实验（2026-09-10）

驱动：`tests/tools/height-experiment/cdp-height-test.mjs`（零依赖裸 CDP，可复现）
环境：macOS（Apple Silicon）· Chrome 152.0.7977.83 · headless=new

## 生成边界（实验事实）

| paperHeight | 结果 | MediaBox(pt) | /UserUnit | PDF 版本 |
| --- | --- | --- | --- | --- |
| 100–910in | ✅ 单页成功 | 与请求一致（910in=65520） | **无** | 1.4 |
| 915in / 1000in | ❌ 显式报错 `Printing failed` | — | — | — |

- 失败边界位于 910–915in 之间；失败是**显式异常**，非静默。
- 边界对应 65536pt（2^16）的说法属**推测**（910in=65520pt 恰在其下），未证实，仅记录。
- 上游数字（page2pdf 200in / pdfsnap 800in"静默失败" / screen-to-pdf 1000in）均与实测不符。

## 阅读器兼容性（product-safe 验证）

| 检查 | 200in | 300in | 600in | 900in |
| --- | --- | --- | --- | --- |
| 结构（MediaBox/UserUnit/版本） | 14400pt · 无 UserUnit · PDF1.4 | 21600pt · 无 · 1.4 | 43200pt · 无 · 1.4 | 64800pt · 无 · 1.4 |
| macOS QuickLook/PDFKit 缩略图 | ✅ | ✅ | ✅ | ✅ |
| macOS Preview 打开 | ✅ | 未测 | 未测 | ✅（已实测打开渲染） |
| Chrome PDFium（headless 截图） | 未测 | 未测 | 未测 | ✅（1/1 页正常渲染） |
| Windows 阅读器 | 未验证 | 未验证 | 未验证 | 未验证 |

关键风险事实：Chrome 输出**不带 `/UserUnit`**，超过 PDF 规范默认 user space 建议（14400 units = 200in）的页面属于超规范输出——本机 macOS/Chrome 栈实测可渲染，但 Windows 阅读器未验证。

## 产品决策（依据规划审核要求）

- **renderer candidate limit = 900in**（保守取整，避开 910–915 边界区）。
- **product-safe cap = 200in**：未获更广泛验证（尤其 Windows 阅读器）前，连续长页产品上限取 200in（恰好与 PDF 默认 user space 建议一致，是"无 UserUnit 输出"的规范安全边界）；超过即自动回退 A4 分页并提示。
- 后续如需提高：先补 Windows 阅读器验证 + 评估 Chromium 输出 UserUnit 的可行性，再调常量。
