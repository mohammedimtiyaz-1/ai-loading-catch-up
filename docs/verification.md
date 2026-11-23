# Verification report

Tested 23 November 2026 on macOS with Node 22.14.0 and Playwright 1.56.1 bundled Chromium. Artifact SHA-256: `5dab75d77d91d21ceac7d421898e950e436a2643f7a6b92503384a2a9d448f93`.

## Automated evidence

| Area | Observation | Result |
| --- | --- | --- |
| Core selection | 50+ sourced concepts, RAG example, alias/sense deduplication, authentication versus AI token, medium-complexity eligibility, ordinary-word filtering, stable third slot | Pass, 9 Node checks |
| Backend | request bounds, malformed provider result, missing credentials, cache reuse, atomic monthly budget, concurrent miss deduplication, five-minute negative cache | Pass, 9 Node checks |
| Installed extension | persistent Chromium context loaded the unpacked MV3 extension against the simulator | Pass |
| Streaming | two question cards remained while the streamed answer added vector database as the third | Pass |
| Lifecycle | regeneration, route navigation, disable/re-enable and duplicate prevention | Pass |
| Accessibility | keyboard opening, Escape, focus restoration, visible popover at 200% page zoom | Pass |
| Cached latency | submitted RAG question to visible two-term panel | 85 ms observed; target was 300 ms |
| Live Tavily lookup | `differential privacy` through the application resolver | resolved with a short explanation and supporting source; immediate repeat returned `cache: backend` |
| Pre-submit lookup | typed `federated learning framework` without submitting | extension showed one sourced Tavily-backed card while the simulator still contained zero user messages |
| Medium-complexity lookup | typed `observability` and `interoperability` before submitting | both specialized terms became lookup-eligible; ordinary long words remained excluded |
| Answer annotations | completed RAG answer with deterministic Tavily resolver responses | five answer concepts were underlined; hover exposed a one-line tooltip |
| Composer anchoring | representative ChatGPT, Claude, and Copilot input shells | panel opened automatically with its top edge aligned to the composer and its left edge exactly 12 px to the right |
| Delayed and narrow composers | delayed ChatGPT mount, 240/300/320 px adaptive widths, constrained viewport | title-only panel opened after mount; constrained layout moved above and remained clear of the input |
| Visual integration | application surface, text color, font family, and viewport bounds | panel matched the host application's dark surface and typography while remaining within the 240–320 px desktop width |
| Panel state | persistent expansion, minimize, reopen, close, Escape, focus restoration, route change | response streaming preserved the open panel; minimize produced a tab; close dismissed it; a new conversation restored the expanded title-only panel |
| Package | ZIP integrity and direct unpacked files | Pass |
| Dependencies | `npm audit --omit=dev` | 0 vulnerabilities |

The final local result was 18/18 Node checks and 12/12 installed-extension browser checks. The ZIP integrity check reported no errors.

## Review and validation

Self-review was used because this task did not request additional agents. Review covered permissions, secret placement, unsafe provider URLs/HTML, request bounds, mixed cache result ordering, stale exchange checks, storage limits and packaged contents. Two reachable defects were fixed before the final run: stale missing icon paths prevented Chrome from loading the extension, and mixed cache hits/misses could reorder results. No actionable findings remain from this review.

The extension requests only `storage` plus explicit loopback and ChatGPT hosts. No provider key or transcript is present in the packaged files. Dynamic definitions use text nodes; external source links accept only HTTP/HTTPS.

## Partially evaluated or deferred

- ChatGPT, Claude, and Copilot adapters are covered by representative input-shell fixtures and shared lifecycle behavior; compatibility in signed-in live sessions is not verified.
- One configured live Tavily miss was verified through the application resolver, followed by a backend-cache hit. Routine provider, failure, timeout, cache and budget checks remain deterministic so the test suite does not spend credits.
- Persistence logic writes individual definitions to `chrome.storage.local`, reconstructs the memory cache after worker restart, and implements bounded batch eviction. Automated Chromium worker termination and a full 1,000-entry/4 MiB eviction run were not performed.
- Dark and light colors are implemented with `prefers-color-scheme`; the automated check covers keyboard and zoom rather than screenshot comparison in both themes.
- CI configuration is prepared but has not run on a remote Git host. No preview, production deployment or browser-store publication occurred.
