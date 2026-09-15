# Chrome Web Store Privacy Disclosure Matrix

This document is the evidence-backed worksheet for the current Chrome Web
Store Privacy practices form. Dashboard wording can change; the owner must map
these rows conservatively to the fields shown in the live dashboard.

## Data handling matrix

| Data type | Source | Purpose | Storage | Transmission | Retention/deletion | Shared or sold? | Trigger |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Website content and resources | Active tab | Capture the requested page, element, or selection and render it as PDF | Page content is not persisted in extension storage | None for ordinary webpage exports | Browser memory only for the export | No | User clicks Save, invokes the shortcut/context menu, or picks an element |
| Current page URL and title | Active tab | Validate the export target, name the PDF, record the PDF source, and report status | Temporarily included in `chrome.storage.session` pending-download metadata | Not sent to a Web Paperize server | Removed after download completion/interruption; also cleared by Chrome on extension disable/reload/update or browser restart | No | User starts an export |
| User-selected text or element | Active tab | Isolate exactly the user-requested content | Not persisted in extension storage | None for ordinary exports | Browser memory/DOM only until page restoration | No | User invokes Selection or Element export |
| Personal communications and user-generated content | Page content; for ChatGPT, the current conversation endpoint | Produce the requested page/selection or complete-conversation PDF | Not persisted in extension storage | ChatGPT conversation data travels directly from ChatGPT/OpenAI to the user's browser; no developer server | Browser memory/DOM only for the export | Not sold or sent to developer/unrelated parties | User explicitly exports content that contains it |
| Authentication information | User's existing ChatGPT session | Authorize the current-conversation and image-URL requests to ChatGPT/OpenAI | Access token is not stored, logged, returned to the service worker, or written to PDF | Sent only back to ChatGPT/OpenAI as required for the user-requested ChatGPT export | Local variable in browser memory for the request sequence | Not sold or sent to developer/unrelated parties | User exports an open ChatGPT conversation while logged in |
| ChatGPT attachment metadata and signed image URLs | ChatGPT/OpenAI | Represent attachments and embed available conversation images in the PDF | Not persisted in extension storage | Image URLs are requested from and loaded from ChatGPT/OpenAI services | Browser memory/DOM only for the export | No unrelated sharing or sale | User exports a ChatGPT conversation containing attachments/images |
| Generated PDF | Chrome rendering pipeline | Deliver the requested PDF | Transient browser memory/blob or data URL; completed file is stored in the user's download location | Not uploaded by Web Paperize | Temporary URL is revoked after terminal download when applicable; saved file remains until user deletes it | No | User starts an export |
| Export preferences | User input in the popup | Remember paper, layout, margin, language, filename, and related settings | `chrome.storage.local` | None | Until changed or extension removal | No | User changes a setting |
| Pending download metadata | Web Paperize download operation | Reconcile a Web Paperize-created download across MV3 service-worker suspension | `chrome.storage.session` | None | Deleted at terminal state; Chrome clears it on disable/reload/update/restart | No | A PDF download is pending |

## Conservative dashboard classification

The owner should expect to disclose at least:

- Website content;
- Authentication information;
- Personal communications and user-generated content when users export such
  material;
- current page URL/title under the closest live-dashboard category for web
  activity or website content.

Do not choose “does not handle user data.” Chrome policy treats local capture
and processing as handling even when the developer never receives the data.

For every disclosed category, the use is the extension's single purpose:
generating a user-requested PDF. The current code does not use data for
advertising, analytics, personalization unrelated to export, creditworthiness,
lending, sale, or transfer to data brokers.

The public policy and live Dashboard certification must also state the Limited
Use commitments explicitly: user data is used only as necessary for the
user-facing PDF export; it is not sold; it is not used or transferred for
personalized advertising; it is not transferred to unrelated third parties;
and humans cannot access user content except when the user explicitly provides
it for support or when security or legal obligations require access.

## Dashboard consistency checklist

- The Privacy practices answers, `PRIVACY.md`, store descriptions, and actual
  package behavior must describe the same data flow.
- Certify Limited Use only after comparing the live certification text with the
  current package.
- Provide a stable public URL for `PRIVACY.md`.
- Treat ChatGPT/OpenAI as the service the user is directly interacting with,
  while still disclosing the session-token and conversation request plainly.
- Re-audit this matrix whenever a new adapter, network destination, telemetry,
  sync storage, account system, or backend is introduced.

## Official references

- <https://developer.chrome.com/docs/webstore/program-policies/user-data-faq>
- <https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements>
- <https://developer.chrome.com/docs/extensions/reference/api/storage>
