# Task: Implement AI Loading Catch Up local extension

- Date: 2026-11-11
- Status: complete
- Requested mode: implementation
- Current delivery stage: local delivery complete
- Integrated revision or immutable artifact identity: ZIP SHA-256 `de6416448e6fd6d59877b95d22fc0cc340d91f3b986401d2202a73a965edad31`
- Backlog/sprint/architecture links: `../project.md`, `../../docs/architecture.md`

## Request and scope

Implement the five-phase local extension plan using plain JavaScript, native Chrome APIs, Node HTTP/SQLite, Tavily integration, automated verification, packaging, and documentation. Do not deploy or publish.

## Acceptance criteria

- Real MV3 extension loads on the simulator with enable/disable behavior.
- Up to three stable contextual definitions appear from question and streamed answer.
- Caches survive worker restarts and stale exchanges cannot update the active UI.
- Optional backend supports bounded cached Tavily lookups without exposing secrets.
- Automated tests exercise core logic, API/cache rules, and the installed extension.
- Documentation and packaged artifact accurately state live-site limitations.

## Role assignments

| Work item | Role | Owned files/subsystem | Depends on | Status | Handoff |
| --- | --- | --- | --- | --- | --- |
| Architecture/onboarding | architect + coordinator | project records/docs | none | complete | boundaries recorded |
| Offline extension | developer + JavaScript + frontend + UX | extension/simulator/shared | architecture | complete | installed extension verified |
| Backend/cache | backend + database + security | backend | shared contracts | complete | deterministic API/cache checks pass |
| Automation/QA | test automation + QA | tests | integrated behavior | complete | 16 checks pass |
| Review/validation/docs/package | reviewer + validation + docs + CI/CD + DevOps | review/docs/dist | checks | complete | self-review and artifact evidence recorded |

## Decisions

- Plain JavaScript, HTML and CSS; no compilation or UI framework.
- Node 22.14+ is the locally verified runtime; node:sqlite is invoked with the experimental flag.
- Online lookup is off by default and loopback-only.
- Live ChatGPT compatibility remains unverified in this delivery.

## Changed behavior

The simulator detects a submitted question, shows at most three contextual definitions, processes streaming and regenerated answers, clears stale state on navigation, and respects extension settings. The background worker owns bounded learned storage and optional loopback resolution. The backend validates bounded candidates, caches definitions/negative results, deduplicates concurrent misses, reserves monthly usage atomically, and keeps Tavily credentials server-side.

## Verification

| Criterion/check | Revision | Environment | Result | Evidence or limitation |
| --- | --- | --- | --- | --- |
| Node tests | packaged revision | local Node 22.14 | pass | 15/15 |
| Playwright extension tests | packaged revision | bundled Chromium | pass | 5/5; cached chip observed at 111 ms and draft terms appeared before submission |
| Live Tavily application lookup | local configured backend | pass | resolved `differential privacy`; repeat served from backend cache |
| Packaging inspection | SHA above | local | pass | ZIP integrity clean; 16 KiB archive |
| Dependency audit | lockfile revision | npm | pass | 0 vulnerabilities |

## Findings and disposition

- Environment provides Node 22.14 rather than planned Node 26; implementation remains compatible with the available built-in SQLite API.
- Self-review fixed invalid missing icon references, mixed cache/miss result ordering, safe source-link validation, and aligned API status/negative-cache behavior.
- Live ChatGPT and live Tavily remain deferred and are labelled in the verification report.

## Final handoff

Deliver `dist/ai-loading-catch-up-unpacked/`, `dist/ai-loading-catch-up-chrome.zip`, the loopback server/simulator, setup guide, verification report, privacy notes and later-hosting checklist. No deployment or publication was performed.
