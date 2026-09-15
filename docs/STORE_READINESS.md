# Chrome Web Store Readiness - 0.2.2 RC

Status: runtime and exact-package acceptance passed, and the final disclosure
consistency adjustments are applied for Owner/Web review. Store submission is
still blocked by the remaining owner actions below; do not submit, tag, or
publish until that review accepts the package and disclosures.

## Readiness audit

| Area | Current result | Remaining owner action |
| --- | --- | --- |
| Single purpose | PASS - every user feature is web content to PDF | Copy the single-purpose statement into the live Privacy tab |
| Manifest V3 | PASS | None |
| Chrome baseline | Chrome 118+ declared and tested | Keep the minimum version in the listing/support copy |
| Host access | PASS - no `host_permissions` or `<all_urls>` | Explain that `activeTab` is user-triggered temporary access |
| Permissions | Every permission maps to current code; `debugger` is the principal review risk | Paste the narrow justifications from `STORE_REVIEW_NOTES.md` |
| User data | Local website-content processing plus explicitly requested ChatGPT/OpenAI conversation retrieval | Complete live Privacy practices checkboxes conservatively |
| Privacy policy | `PRIVACY.md` covers data, purpose, transfer, retention, deletion, Limited Use, and contact | Publish/confirm a stable publicly accessible policy URL |
| Remote code | PASS - no remotely hosted executable code, eval, minification, or obfuscation | None |
| Third-party code | Mozilla Readability and implementation provenance are documented and licensed in-package | None |
| Store package | Explicit allowlist; reproducible ZIP; clean extraction and dependency audit | Upload only the reviewed ZIP whose SHA-256 matches the accepted record |
| Listing copy | English and Simplified Chinese drafts prepared | Paste/localize in the Dashboard and verify live length/format validation |
| Interface-language information architecture | RESOLVED before RC - the UI language control is in a separate preferences section after Save/Pick and explicitly says it does not change webpage or PDF content | Do not move it back into export parameters |
| Store graphics | 128x128 icon exists; screenshots and promo images are missing | Produce and upload accepted final assets |
| Developer account | Unknown from repository | Register publisher, pay current fee, enable 2-Step Verification, verify contact email |
| Submission | Not authorized in this phase | Start Unlisted review only after Owner acceptance |

## Policy risk ranking

1. Privacy consistency for the ChatGPT adapter. The policy, listing, dashboard
   categories, and package must all say that the user's existing ChatGPT session
   is used only for the requested conversation export.
2. `debugger` permission. It is technically necessary for vector PDF rendering,
   but sensitive execution permissions can receive longer review. Keep the
   justification narrow and the authored source readable.
3. Exact-package drift. Never upload a hand-made repository ZIP or an artifact
   that has not passed extraction and runtime smoke.
4. Store asset quality. The runtime icon exists, but screenshots and promotional
   tiles still determine whether the listing looks complete and understandable.
5. Platform/site drift. Chrome enterprise policy and private ChatGPT response
   changes are known maintenance risks, not reasons to broaden permissions.

## Release version and package

The first Store release candidate is `0.2.2`. This is a packaging, disclosure,
and listing milestone in the existing 0.2 line; it does not reopen the V0.3
roadmap or add product behavior.

Build:

```sh
npm run package:store
```

The build creates:

```text
dist/web-paperize-0.2.2.zip
dist/web-paperize-0.2.2.zip.sha256
```

The script:

- copies only the explicit `STORE_FILES` allowlist;
- rejects symlinks, unsafe paths, PDFs, development directories, and unlisted
  files;
- normalizes file timestamps and strips extra ZIP metadata;
- places `manifest.json` at the ZIP root;
- extracts into a new temporary directory;
- verifies manifest paths, localized manifest messages, HTML/JavaScript package
  dependencies, and the exact file list;
- runs `unzip -t` and emits SHA-256.

`dist/` is intentionally ignored by Git. The binary RC must be regenerated from
the reviewed source and compared by checksum rather than committed casually.

## Exact-package acceptance procedure

Static acceptance:

1. Run `npm test`, `npm audit`, and `git diff --check`.
2. Run `npm run package:store` twice and require identical ZIP bytes/SHA-256.
3. Extract the final ZIP into a new temporary directory.
4. Confirm its file list equals the allowlist and includes no development or
   temporary artifacts.
5. Load that extracted directory in an isolated Chrome profile. Do not use the
   repository checkout as a substitute.

Runtime smoke from the extracted package:

- Original whole-page export;
- Auto HIGH -> Paperized;
- Auto LOW -> Original;
- forced Paperized;
- Element export;
- Selection export;
- English and Simplified Chinese popup plus context menus;
- ChatGPT complete-conversation adapter only when a suitable logged-in test
  session is available.

For each produced PDF, verify identity from fresh marker text, page count,
searchable text, expected links, and rendered PNG output. File existence or size
alone is not acceptance evidence.

## Exact-package validation record - 2026-09-15

Final reproducible RC artifact after the Owner-requested disclosure and static
localization closure:

```text
dist/web-paperize-0.2.2.zip
entries: 40
bytes: 109259
sha256: 2dbb37bb6f4e4c07e79e04e1c11113d12d63e1f276959498e07fb326c8ea640c
```

Two consecutive allowlist builds produced identical ZIP bytes and SHA-256.
`shasum -a 256 -c` and `unzip -t` passed, the archive extracted with
`manifest.json` at its root, and the archive contained no development,
documentation, test, package-manager, PDF, Git, or temporary paths.

The full six-route runtime smoke below was performed on the immediately prior
allowlist artifact (`1d6b96b18e87c830ea341acc17f30fedcb1bb967aef4a3156a32dc2250cc3d45`,
109253 bytes). The only packaged changes in the final artifact above are the
static English and Simplified Chinese extension display name and description;
no manifest structure or runtime JavaScript changed. Exact localization
assertions, the full 143-test suite, and clean-extraction package validation all
pass for the final artifact.

The runtime-smoked ZIP was extracted into a newly created temporary directory and loaded as the
only non-system extension in a fresh Google Chrome for Testing
`147.0.7727.15` profile. The repository checkout was not loaded. All six PDFs
below were generated by that exact extracted package:

| Smoke | Runtime result | PDF evidence |
| --- | --- | --- |
| Auto LOW | Chose Original for the compact readable-color fixture | 1 page, 51792 bytes, 1 link; rendered output byte-identical to forced Original |
| Original | Popup reported `Saved ... · Original` | 1 page, 51792 bytes, 1 link; full source fixture preserved |
| Paperized | Popup reported `Saved ... · Paperized` | 1 page, 49921 bytes, 1 link; owned article header, searchable text, code style, and readable contrast preserved |
| Auto HIGH | Chose Paperized for `benchmark.html` | 3 pages, 264514 bytes, 2 links; all expected sections and the final paragraph are present |
| Element | Chinese picker hint displayed; selected the code block | 1 page, 7839 bytes, 0 links; extracted text is exactly `const readable = true;` |
| Selection | Chinese selection context-menu command displayed | 1 page, 19736 bytes, 0 links; extracted text is exactly the selected sentence |

The interface-language setting changed the popup and extension context menus in
both English and Simplified Chinese, persisted after reload, and explicitly
stated that it does not change webpage or PDF content.

Rendered-PNG inspection of every page passed. In particular, Auto HIGH contains
`CV-AUTO-MARKER`, all six inner-scroller paragraphs through
`END-OF-SCROLLER-MARKER`, all four colored lazy/data-source images (including
the red `LAZY 4 data-src convention` image), the complete wide table, readable
unclipped code, and the final paragraph. `CV-HIDDEN-MARKER` is absent. The three
pages have continuous content flow without a wasteful blank page or repeated
sticky header.

Earlier, now-superseded candidate builds exposed three acceptance defects. Each
was fixed before the artifact above was built and has a focused regression test:

1. A direct `data-src` data URI containing spaces was incorrectly split like a
   `srcset` candidate. Direct lazy-source attributes now remain intact.
2. `content-visibility:hidden` content could enter Paperized extraction. Hidden
   clone subtrees are now pruned while `auto` content remains printable.
3. Readability's class/id heuristic could discard a bounded inner scroller even
   after it was expanded. Capture now marks the positively detected scroller,
   protects it during detached extraction, and restores the live page exactly.

Final local gates: `npm test` passed 143/143, `npm audit` reported zero
vulnerabilities, and `git diff --check` passed.

The logged-in ChatGPT exact-package smoke was not run because the isolated test
profile intentionally had no ChatGPT session. Automated ChatGPT adapter tests
are included in the passing suite, but a logged-in acceptance run remains an
Owner pre-submission check and must be repeated again after installing the Store
ID build.

The test browser, generated QA PDFs, rendered PNGs, and temporary extracted
profiles are disposable evidence and are removed after this record is written.
The accepted ZIP and checksum remain in `dist/`.

## Store asset inventory

| Asset | Requirement | Current state | Recommendation |
| --- | --- | --- | --- |
| Store icon | 128x128 PNG | Present; exact 128x128 PNG, recognizable purple paper mark | Keep for RC unless product review requests a higher-detail brand pass |
| Screenshots | At least one, up to five, 1280x800 | Missing | Prepare four English and four matching Chinese screenshots |
| Small promo tile | 440x280 PNG/JPEG | Missing | Prepare after screenshot visual direction is accepted |
| Marquee promo tile | 1400x560 PNG/JPEG, optional | Missing | Defer unless launch promotion requires it |
| Video | Dashboard currently exposes a YouTube field | Missing/optional for this RC decision | Do not block the first Unlisted validation unless the live form marks it required |

The current icon has the required pixel dimensions and transparent corners. It
is usable as a Store RC icon, although only a 128px raster master exists; future
marketing assets should not upscale it as the main artwork.

### Four-screenshot storyboard

Each locale should use the same composition and page examples so only the UI
copy changes.

1. **Auto layout:** toolbar popup open on a clear article, highlighting Auto and
   the concise paperization hint.
2. **Article to Paperized PDF:** source article beside a clean, readable PDF page
   with selectable text and an obvious link annotation.
3. **Original layout:** a visually structured webpage beside its layout-preserved
   PDF, showing why Original is distinct from Paperized.
4. **ChatGPT complete content:** a long/virtualized conversation beside the
   complete PDF, with a small disclosure that export uses the current session
   and that Web Paperize is independent from OpenAI.

Avoid tiny body copy, browser/profile identifiers, private conversation content,
competing-product logos, fake ratings, or claims that cannot be reproduced.

## Owner Dashboard checklist

1. Use a durable publisher Google account whose inbox is actively monitored.
2. Complete current developer registration, fee, agreement, contact verification,
   and mandatory 2-Step Verification.
3. Host and verify the public `PRIVACY.md` URL.
4. Create one Store item. Do not create a second duplicate item for testing.
5. Upload only the accepted 0.2.2 ZIP and record the Store extension ID.
6. Complete Listing, Privacy, Distribution, and Test instructions using the
   repository drafts; reconcile every live field instead of assuming old labels.
7. Select **Unlisted** for the first submission. Unlisted still receives the same
   policy review as Public.
8. Prefer deferred publishing if the live workflow permits it, so approval and
   release timing remain separate decisions.
9. After review, disable (do not immediately remove) the unpacked development
   extension, install the Store build, set preferences again, and run the full
   Store-ID smoke. Local unpacked storage does not migrate to the new Store ID.
10. Verify install warnings, permissions, PDF modes, interface languages,
    ChatGPT behavior where available, and one update path before changing the
    same item from Unlisted to Public.

## Official references checked for this RC

- Program policies: <https://developer.chrome.com/docs/webstore/program-policies>
- User data FAQ: <https://developer.chrome.com/docs/webstore/program-policies/user-data-faq>
- Disclosure requirements: <https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements>
- Review process: <https://developer.chrome.com/docs/webstore/review-process>
- Prepare/upload package: <https://developer.chrome.com/docs/webstore/prepare>
- Listing and graphic assets: <https://developer.chrome.com/docs/webstore/cws-dashboard-listing>
- Distribution visibility: <https://developer.chrome.com/docs/webstore/cws-dashboard-distribution>
- Developer registration: <https://developer.chrome.com/docs/webstore/register>
- Chrome storage retention: <https://developer.chrome.com/docs/extensions/reference/api/storage>
- Debugger API: <https://developer.chrome.com/docs/extensions/reference/api/debugger>
