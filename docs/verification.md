# Verification report

Tested 23 November 2026 on macOS with Node 22.14.0 and Playwright 1.56.1 bundled Chromium. Artifact SHA-256: `cdbb67c95556b05b8fa8d7f6670d47982118b3796ab27593a3f4e6b19d4647ed`.

## Automated evidence

| Area | Observation | Result |
| --- | --- | --- |
| Core selection | 50+ sourced concepts, RAG example, alias/sense deduplication, authentication versus AI token, low/medium technical eligibility, phrase preservation, ordinary-word filtering | Pass, 10 Node checks |
| Backend | request bounds, malformed provider result, missing credentials, cache reuse, atomic monthly budget, concurrent miss deduplication, five-minute negative cache | Pass, 9 Node checks |
| Installed extension | persistent Chromium context loaded the unpacked MV3 extension against the simulator | Pass |
| Inline-only UI | extension mounted only its tooltip host | no panel, chip, or separate window was rendered |
| Draft highlighting | typed technical terms in contenteditable and native textarea composers | after three quiet seconds, visual overlays added visible styling without changing either editor DOM or requiring the CSS Highlight API |
| Question annotations | submitted RAG question | RAG and hallucinations received a tinted background and underline after three quiet seconds |
| Streaming | observed an answer while tokens were arriving | no early annotations; stable answer terms appeared after the three-second quiet period |
| Lifecycle | regeneration, route navigation, disable/re-enable and duplicate prevention | question and answer annotations remained independent; route changes cleared stale marks |
| Accessibility | hover, keyboard focus, Escape, responsive tooltip width | compact one-line tooltip remained at or below 270 px and dismissed with Escape |
| Live Tavily lookup | `differential privacy` through the application resolver | resolved with a short explanation and supporting source; immediate repeat returned `cache: backend` |
| Low-complexity lookup | submitted `semantic tuning` with a cached definition | the complete phrase was underlined and its one-line explanation appeared on hover |
| Batched resolution | stable message contained uncached concepts | unresolved candidates are sent once per message in one batch of at most three after debounce |
| Answer annotations | completed and regenerated RAG answers | curated terms were underlined without requiring online lookup |
| Package | ZIP integrity and direct unpacked files | Pass |
| Dependencies | `npm audit --omit=dev` | 0 vulnerabilities |

The final local result was 19/19 Node checks and 9/9 installed-extension browser checks. The ZIP integrity check reported no errors.

## Review and validation

Self-review was used because this task did not request additional agents. Review covered permissions, secret placement, unsafe provider URLs/HTML, request bounds, mixed cache result ordering, stale exchange checks, storage limits and packaged contents. Two reachable defects were fixed before the final run: stale missing icon paths prevented Chrome from loading the extension, and mixed cache hits/misses could reorder results. No actionable findings remain from this review.

The extension requests only `storage` plus explicit loopback and ChatGPT hosts. No provider key or transcript is present in the packaged files. Dynamic definitions use text nodes; external source links accept only HTTP/HTTPS.

## Partially evaluated or deferred

- ChatGPT, Claude, and Copilot selectors remain implemented. Version 0.5.2 was exercised against the local lifecycle simulator and a representative ChatGPT contenteditable draft; signed-in live-session behavior remains dependent on the installed extension being reloaded.
- One configured live Tavily miss was verified through the application resolver, followed by a backend-cache hit. Routine provider, failure, timeout, cache and budget checks remain deterministic so the test suite does not spend credits.
- Persistence logic writes individual definitions to `chrome.storage.local`, reconstructs the memory cache after worker restart, and implements bounded batch eviction. Automated Chromium worker termination and a full 1,000-entry/4 MiB eviction run were not performed.
- Tooltip colors and typography are derived from the marked chat content; screenshot comparison in both themes was not performed.
- CI configuration is prepared but has not run on a remote Git host. No preview, production deployment or browser-store publication occurred.
