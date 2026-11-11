# Software team project profile

## Product

- Purpose: Explain up to three difficult concepts while an AI chat answer streams.
- Users: English-speaking desktop Chromium users who want brief contextual explanations.
- Domain terms: exchange, question term, answer term, canonical sense, learned definition.
- Constraints: plain JavaScript/HTML/CSS; local-first; free services only; no transcript persistence; no deployment.

## Technology

- Languages and frameworks: JavaScript ES modules, HTML, CSS, Chrome Manifest V3.
- Runtime versions: Node.js 22.14+ verified locally; Chromium through Playwright for automated tests.
- Data stores: chrome.storage.local in extension; SQLite through node:sqlite in backend.
- External services: Tavily Search API, optional and setup-required.

## Repository map

- Primary entrypoints: extension/background.js, extension/content.js, backend/server.js.
- Main components: extension, simulator, backend, tests.
- Architecture boundaries: content script observes visible chat DOM; background owns settings/cache/network; backend owns provider secret/shared cache.

## Commands

- Setup: `npm install`
- Development: `npm run dev`, then load `extension/` unpacked.
- Build: no compilation; extension source is the artifact.
- Lint/typecheck: JavaScript syntax checks are included in tests/package verification.
- Tests: `npm test`; `npm run test:browser`; `npm run check`.
- Migrations: SQLite schema initializes transactionally in backend/cache.js.

## Conventions and instructions

- Authoritative instructions: user implementation plan and repository README.
- Coding conventions: browser-native APIs, ES modules where supported, no remote code, bounded inputs.
- Branch/review conventions: repository is not yet initialized as Git; self-review must be labelled.

## Environments and delivery

- Environments: local development only.
- Release process: run checks, package extension ZIP, retain evidence report.
- Recovery or rollback: retain prior ZIP; delete learned local data through settings; backend SQLite file is replaceable locally.

## Integrations

| Integration | Status | Purpose |
| --- | --- | --- |
| Tavily | setup required | Resolve uncached concepts |
| Playwright | project dependency | Real extension regression tests |

## Scrum and delivery configuration

- Product Goal and Product Owner: deliver local AI Loading Catch Up prototype; user owns product decisions.
- Sprint cadence: single implementation increment for this request.
- Backlog and sprint record links: `.software-team/tasks/2026-11-11-ai-loading-catch-up.md`
- Architecture decision and selected capabilities: plain MV3 extension + native Node backend.
- Preview provider/project/environment: unconfigured
- Production provider/project/environment: unconfigured
- Required CI checks and acceptance criteria: Node tests, Playwright extension tests, package inspection, A1-A19 assessment.
- Preview policy: not configured.
- Production policy: explicit approval for the exact revision and environment.
- Monitoring signals and thresholds: not configured; local logs only.
- Monitoring cadence: not applicable before deployment.
- Existing automation ID: none.
- Recovery authorization: none unless explicitly configured.

## Completion criteria

- Acceptance criteria evaluated.
- Relevant checks executed and reported accurately.
- Findings resolved or disclosed.
- Required documentation updated.
