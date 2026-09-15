# Web Paperize Privacy Policy

Last updated: September 15, 2026

Web Paperize saves webpages or user-selected web content as PDF documents. The
extension handles page content inside the user's browser to perform that
user-requested export. The Web Paperize developer does not operate a backend
service for the extension and does not receive the content being exported.

## Data handled during an export

Depending on the export mode, Web Paperize may temporarily process:

- the content, styling, images, links, title, and URL of the active webpage;
- the element or text selection explicitly chosen by the user;
- the generated PDF bytes and the requested local filename;
- layout measurements and export status needed to complete and restore the page;
- for a ChatGPT complete-conversation export, the current conversation,
  referenced sources, attachment metadata, and conversation image download
  URLs returned by ChatGPT/OpenAI.

Normal webpage exports are processed locally in Chrome. They do not send page
content to a Web Paperize server or any unrelated third party.

## ChatGPT complete-conversation exports

This feature runs only when the user initiates an export from an open
conversation on `chatgpt.com` or `chat.openai.com`.

Web Paperize uses the user's existing ChatGPT login session to request the open
conversation directly from ChatGPT/OpenAI. It may also request download URLs
from ChatGPT/OpenAI for images in that conversation. These requests are made
solely to build the PDF the user asked for.

The ChatGPT access token is used transiently in browser memory. It is not
logged, stored, included in the generated PDF, returned to the extension's
service worker, or sent to the Web Paperize developer or an unrelated third
party. Conversation content is not uploaded to or retained by a Web Paperize
server because no such server exists.

Web Paperize is an independent extension and is not affiliated with OpenAI.

## Local storage and retention

- Export preferences, including paper, layout, margins, filename template, and
  interface language, are stored in `chrome.storage.local`. Chrome retains this
  extension-specific data until it is changed or the extension is removed.
- While a Chrome download is pending, Web Paperize stores only the metadata
  needed to reconcile that download in `chrome.storage.session`, such as its
  Chrome download ID, filename, size, page title/URL, layout result, and a
  temporary blob URL when applicable. An entry is deleted after Chrome reports
  the download complete or interrupted. Chrome also clears session storage
  when the extension is disabled, reloaded, or updated, or when Chrome restarts.
- Page and conversation content are not persisted in extension storage.
- Generated PDF data exists transiently in browser memory and a temporary blob
  or data URL while Chrome accepts the download.
- The completed PDF is saved through Chrome's Downloads API to the location
  selected by the user's Chrome download settings. It is the user's local file;
  Web Paperize does not upload or automatically delete it.

Removing Web Paperize clears its `chrome.storage.local` data according to
Chrome's extension-storage behavior. Removing the extension does not delete
PDF files the user has already saved.

## Collection, telemetry, sharing, and sale

Web Paperize does not collect telemetry, analytics, crash reports, browsing
history, or advertising identifiers. It does not sell user data. It does not
transfer exported content to the developer, advertisers, data brokers, or
unrelated third parties. It does not use user data for advertising,
creditworthiness, lending, or any purpose unrelated to generating the
user-requested PDF.

The extension does not allow the developer or other humans to read exported
content. If a user voluntarily includes content in a support request, that
separate disclosure is controlled by the user and is not automatic extension
collection.

## Permissions

Web Paperize uses only the permissions needed for its PDF-export purpose:

- `activeTab` and `scripting` process the active page only after the user invokes
  an export or picker action.
- `debugger` temporarily attaches to that tab to use Chrome DevTools Protocol
  print and emulation commands, including `Page.printToPDF`; it detaches after
  success or failure and is not used for background browsing monitoring.
- `downloads` saves the PDF and observes the status of downloads created by Web
  Paperize.
- `storage` keeps local preferences and short-lived pending-download metadata.
- `offscreen` creates and revokes a temporary PDF blob URL because an extension
  service worker cannot create one directly.
- `contextMenus` provides user-initiated page, selection, and element export
  actions.

The manifest does not request broad host permissions such as `<all_urls>`.

## Chrome Web Store Limited Use

Web Paperize's use and transfer of information received from websites and
Chrome APIs adheres to the Chrome Web Store User Data Policy, including the
Limited Use requirements.

- Web Paperize accesses and uses user data only as necessary to provide the
  user-facing PDF export functionality the user requested.
- Web Paperize does not sell user data.
- Web Paperize does not use or transfer user data for personalized advertising.
- Web Paperize does not transfer user data to unrelated third parties. The
  direct ChatGPT/OpenAI requests described above occur only for a
  user-requested ChatGPT export and are necessary to provide that feature.
- Web Paperize does not allow the developer or other humans to access user
  content, except when a user explicitly chooses to provide content for
  support, or when access is required for security or legal obligations.

## Contact and changes

Questions can be filed in the project's public issue tracker:
<https://github.com/ckstar069/web-paperize/issues>.

Material privacy changes will be documented here and disclosed through the
Chrome Web Store listing or extension UI when required before the changed data
practice takes effect.

---

# Web Paperize 隐私政策

最后更新：2026 年 9 月 15 日

Web Paperize 将网页或用户明确选择的网页内容保存为 PDF。扩展会在用户的浏览器内处理
完成该导出所必需的页面数据。Web Paperize 开发者不运营扩展后端，也不会收到被导出
的内容。

## 导出过程中处理的数据

根据导出模式，Web Paperize 可能临时处理：

- 当前网页的内容、样式、图片、链接、标题和 URL；
- 用户明确选择的元素或文本选区；
- 生成的 PDF 数据和本地文件名；
- 完成导出并恢复页面所需的布局测量与状态；
- 导出 ChatGPT 完整会话时，该会话、引用来源、附件元数据，以及 ChatGPT/OpenAI 返回
  的会话图片下载 URL。

普通网页导出由 Chrome 在浏览器本地处理，不会把网页内容发送到 Web Paperize 服务器或
任何无关第三方。

## ChatGPT 完整会话导出

只有当用户在 `chatgpt.com` 或 `chat.openai.com` 的已打开会话中主动发起导出时，
此功能才会运行。

Web Paperize 使用用户现有的 ChatGPT 登录会话，直接向 ChatGPT/OpenAI 请求当前打开
的会话；如会话中包含图片，还可能向 ChatGPT/OpenAI 请求图片下载 URL。上述请求仅
用于生成用户要求的 PDF。

ChatGPT 访问令牌只在浏览器内存中短暂使用，不会被记录、持久化、写入 PDF、返回扩展
Service Worker，也不会发送给 Web Paperize 开发者或无关第三方。Web Paperize 没有
后端服务器，因此不会在自有服务器上传或保留会话内容。

Web Paperize 是独立扩展，与 OpenAI 无关联。

## 本地存储与保留周期

- 纸张、布局、页边距、文件名模板和界面语言等偏好保存在
  `chrome.storage.local`，由 Chrome 保留到用户更改设置或卸载扩展。
- Chrome 下载待完成期间，Web Paperize 只在 `chrome.storage.session` 保存恢复下载状态
  所需的元数据，例如下载 ID、文件名、大小、页面标题/URL、布局结果和临时 blob URL。
  Chrome 报告完成或中断后即删除；禁用、重载或更新扩展以及重启 Chrome 时，Chrome
  也会清除此会话存储。
- 网页与会话正文不会持久化到扩展存储。
- PDF 数据只在 Chrome 接收下载期间短暂存在于浏览器内存和临时 blob/data URL。
- 最终 PDF 通过 Chrome Downloads API 保存到用户 Chrome 下载设置指定的位置，属于
  用户本地文件；Web Paperize 不上传，也不会自动删除。

按 Chrome 的扩展存储行为，卸载 Web Paperize 会清除其 `chrome.storage.local` 数据，
但不会删除用户已经保存的 PDF。

## 收集、遥测、共享与出售

Web Paperize 不收集遥测、分析数据、崩溃报告、浏览历史或广告标识，不出售用户数据，
也不会把导出内容传给开发者、广告商、数据经纪商或无关第三方。用户数据不会用于广告、
信用评估、贷款或任何与生成用户所请求 PDF 无关的目的。

扩展不会让开发者或其他人员读取导出内容。如果用户自行在支持请求中附带内容，这是由
用户控制的单独披露，并非扩展自动收集。

## 权限

- `activeTab` 与 `scripting`：仅在用户发起导出或元素选择后处理当前活动页面。
- `debugger`：仅在导出期间短暂连接当前标签页，调用 Chrome DevTools Protocol 的打印
  与模拟命令（包括 `Page.printToPDF`）；成功或失败后都会断开，不用于后台浏览监控。
- `downloads`：保存 PDF，并观察 Web Paperize 自己创建的下载状态。
- `storage`：保存本地偏好和短期待完成下载元数据。
- `offscreen`：因 Service Worker 不能直接创建 blob URL，用于创建和撤销临时 PDF URL。
- `contextMenus`：提供由用户主动触发的页面、选区和元素导出入口。

扩展不申请 `<all_urls>` 等广泛 host permissions。

## Chrome Web Store Limited Use

Web Paperize 对网站和 Chrome API 信息的使用与传输遵守 Chrome Web Store User Data
Policy（包括 Limited Use 要求）。

- Web Paperize 仅在提供用户主动要求的 PDF 导出功能所必需的范围内访问和使用用户数据；
- 不出售用户数据；
- 不将用户数据用于个性化广告，也不为个性化广告传输用户数据；
- 不向无关第三方传输用户数据；上述直接访问 ChatGPT/OpenAI 的请求只在用户主动要求
  导出 ChatGPT 会话时发生，并且仅用于提供该功能；
- 不允许开发者或其他人员访问用户内容，除非用户明确选择在支持请求中提供内容，或安全、
  法律义务要求访问。

## 联系与变更

问题可提交到项目公开 issue：<https://github.com/ckstar069/web-paperize/issues>。

如隐私实践发生实质变化，将在这里记录，并在需要时通过 Chrome Web Store 页面或扩展
界面提前披露。
