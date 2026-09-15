# Chrome Web Store Listing - English

## Name

Web Paperize

## Short description

Save web content as high-quality PDFs using Chrome's native rendering. No Web Paperize server or telemetry.

## Single-purpose statement

Save web content as high-quality PDF documents.

## Full description

Web Paperize turns webpages and user-selected web content into searchable,
selectable PDF documents rendered by Chrome.

Choose the output that fits the page:

- Auto uses a paper-friendly layout for reliable reading content and otherwise
  preserves the original webpage.
- Paperized extracts the main reading content and formats it for clear,
  paginated reading.
- Original keeps the webpage's current layout.
- Export a whole page, one picked element, or a text selection.
- Save a ChatGPT conversation as a complete, printable document when you
  explicitly export an open conversation.
- Switch the Web Paperize interface between Auto, 简体中文, and English without
  changing the page or PDF language.

PDF generation happens in your browser. Web Paperize has no developer backend
server and collects no telemetry. Ordinary webpages are processed locally. For
an explicitly requested ChatGPT complete-conversation export, the extension uses
your existing ChatGPT session to request that conversation directly from
ChatGPT/OpenAI solely to create the PDF. The developer does not receive your
token or conversation.

Web Paperize is an independent extension and is not affiliated with OpenAI.

## Permission summary

- Active tab and scripting: prepare only the page you ask to export.
- Debugger: temporarily use Chrome's print-to-PDF and print-emulation commands;
  detach after the export succeeds or fails.
- Downloads: save the generated PDF and report its completion.
- Storage: remember local export preferences and short-lived pending-download
  metadata.
- Offscreen: create a temporary PDF blob URL for the Chrome download.
- Context menus: provide page, selection, and element export actions.

The extension requests no broad host permission and does not monitor browsing in
the background.

## Support and known limitations

- Requires Chrome 118 or later.
- Chrome internal pages and Chrome Web Store pages cannot be exported.
- Text selection inside an iframe is not currently supported.
- Complete ChatGPT export requires the user to be signed in and to have an open
  conversation.
- Chrome shows its standard debugging notification while the PDF renderer is
  attached to the active tab.
- One continuous page is capped at Chromium's safe PDF height; oversized output
  falls back to paginated A4.

Privacy policy:
<https://github.com/ckstar069/web-paperize/blob/main/PRIVACY.md>

Support:
<https://github.com/ckstar069/web-paperize/issues>
