# Chrome Web Store Reviewer Notes

## Single purpose

Web Paperize saves web content as high-quality PDF documents. Whole-page,
element, text-selection, paper-friendly layout, original layout, and ChatGPT
complete-conversation export are modes of that one web-content-to-PDF purpose.

## Permission justifications

| Permission | Narrow reviewer justification | Code evidence |
| --- | --- | --- |
| `activeTab` | Grants temporary access only to the active page after the user invokes the toolbar action, shortcut, or context-menu command. The extension has no broad host permission. | `src/background/service-worker.js` (`activeTab`, `runCapture`); `src/popup/popup.js` |
| `scripting` | Injects the capture preparation, article extraction, element picker, page isolation, and restoration functions into only the user-invoked active tab. | `src/background/capture.js`; `src/background/paperize.js`; `src/background/service-worker.js` (`startPicker`) |
| `downloads` | Starts the generated PDF download and observes only Web Paperize-created download IDs so the UI can report complete/interrupted status and release the temporary blob URL. | `src/background/download.js` |
| `storage` | Stores export preferences in `storage.local` and short-lived pending-download metadata in `storage.session`. Page or conversation bodies are not stored. | `src/background/settings.js`; `src/background/download.js` |
| `offscreen` | Creates and revokes a temporary blob URL for PDF bytes because an MV3 service worker cannot call `URL.createObjectURL`. The offscreen document closes when no Web Paperize download remains pending. | `src/background/download.js`; `src/offscreen/offscreen.js` |
| `debugger` | Used only during a user-initiated export to call Chrome DevTools Protocol print and emulation methods, principally `Page.printToPDF`. Attach is reference-counted and `withDebugger` guarantees detach in `finally` on success or failure. It is not used for passive or background browsing monitoring. | `src/background/cdp.js`; `src/background/capture.js`; `src/background/paperize.js` |
| `contextMenus` | Adds explicit page, selection, element, and visible-page PDF export commands. Each command requires a user click. | `src/background/context-menus.js`; `src/i18n/context-menus.js`; `src/background/service-worker.js` |

The manifest intentionally requests no `host_permissions`, `<all_urls>`,
`tabs`, `cookies`, `webRequest`, or remote-code capability.

## `debugger` lifecycle and CDP scope

The extension attaches only after `runCapture` validates a user-invoked active
tab. The CDP methods used are limited to page measurement/printing, screen-media
and viewport emulation, stream reads, and cleanup. The normal lifetime is:

1. attach to the selected tab;
2. prepare and measure the page;
3. call `Page.printToPDF` and read the result;
4. restore page state and emulation;
5. detach in `finally`, including error paths.

Chrome may show its standard debugging notification during this interval.
There is no periodic attach, navigation monitoring, request interception,
background browsing collection, or developer server.

Chrome 155 introduces stricter attach failures only for managed browsers where
an administrator configures `runtime_blocked_hosts`, `DisableScreenshots`, or
applicable DLP rules. Unmanaged browsers are unaffected. The extension already
surfaces attach failures rather than attempting to bypass policy.

Official reference:
<https://developer.chrome.com/blog/debugger-enterprise-policy-restrictions>

## User data and network behavior

Ordinary webpage export performs no extension-initiated remote request. Content
is processed in the active tab and PDF bytes are delivered to Chrome's local
Downloads API.

On an open ChatGPT conversation only, a user-initiated complete-content export
runs a bundled adapter in the page. It uses the user's existing ChatGPT session
to request that conversation and any needed image download URLs directly from
ChatGPT/OpenAI. The access token remains transient browser memory and is not
returned, stored, logged, or sent to the developer. See `PRIVACY.md` and
`docs/STORE_PRIVACY_DISCLOSURE.md`.

The four adapter modules listed as `web_accessible_resources` are bundled in the
ZIP and limited to `https://chatgpt.com/*` and `https://chat.openai.com/*`.
This declaration exposes package resources to those pages; it is not a broad
host permission.

## Third-party and remote code

- All executable JavaScript is included in the submitted ZIP as readable,
  authored source. There is no remotely hosted executable code, `eval`, dynamic
  code download, minification, or obfuscation.
- Mozilla Readability 0.6.0 is vendored unchanged under Apache-2.0. Its license
  and provenance are included.
- MIT-derived design/code notices are included in `THIRD_PARTY_NOTICES.md`.

## Reviewer test instructions

Prerequisites: Chrome 118 or later. No account is required for ordinary webpage
export.

1. Open a normal HTTPS article and click the Web Paperize toolbar icon.
2. Select Original, then Save as PDF. Confirm Chrome downloads a searchable PDF.
3. Select Auto on a clear article. Confirm the result is reported as Paperized;
   on a short/non-article page, Auto preserves Original layout.
4. Use the context menu to export selected text, then use “Pick an element…” to
   export one page region.
5. Switch Interface language between English and 简体中文 and confirm the popup
   and context menu change without changing PDF content.
6. Optional ChatGPT-specific test: sign in with a reviewer-owned ChatGPT
   account, open a conversation, and click Save as PDF. The dedicated path
   produces a complete-conversation document. The developer does not provide or
   require shared test credentials.

Known limitations:

- browser-internal pages and Chrome Web Store pages cannot be captured;
- selection export currently supports the top-level page, not iframe selection;
- ChatGPT complete-content export depends on an active ChatGPT session and may
  require maintenance if that site's private response shape changes;
- continuous single-sheet output is capped at 200 inches and safely falls back
  to paginated A4 when over the Chromium PDF limit;
- a managed Chrome 155+ environment may block `chrome.debugger` by enterprise
  host, screenshot, or DLP policy.

## Package identity

Build the submitted artifact with `npm run package:store`. The script uses an
explicit file allowlist, fixed timestamps, stripped ZIP metadata, a clean
temporary extraction, dependency/path validation, and SHA-256 output. Submit the
generated `dist/web-paperize-0.2.2.zip`, not a ZIP of the repository.

Official references:

- <https://developer.chrome.com/docs/webstore/prepare>
- <https://developer.chrome.com/docs/webstore/review-process>
- <https://developer.chrome.com/docs/extensions/reference/api/debugger>
- <https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq>
