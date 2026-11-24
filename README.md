# AI Chat Keyword Explainer

AI Chat Keyword Explainer is a local Chrome extension that explains technical concepts directly inside AI conversations. Version 0.5.4 removes the separate explanation window: every eligible technical term receives a visible tinted background and solid underline, and a compact one-line explanation appears on hover or keyboard focus. Semantic tuning, semantic search, and model drift have built-in sourced definitions, so they work without Tavily or an online-lookup setting.

![AI Chat Keyword Explainer highlighting RAG and tokens with a compact hover explanation](docs/screenshots/ai-chat-keyword-explainer-v0.5.2-inline-tooltip.png)

![AI Chat Keyword Explainer showing five underlined answer concepts and a Tavily-backed hover explanation](docs/screenshots/ai-loading-catch-up-inline-tavily.png)

The extension uses non-destructive visual overlays for both contenteditable and native textarea composers, so eligible draft terms become visible without changing the editor DOM or depending on the optional CSS Highlight API. Drafts and submitted questions wait 600 ms after typing stops; streamed answers wait 900 ms after the latest change. Up to 20 eligible terms are considered per message, while missing definitions remain grouped into one request of at most three candidates to control Tavily usage. Ordinary conversational words remain excluded.

The extension skips links, code, controls, and editable content when adding underlines. Tavily requests contain only candidate terms, domains, and short meaning hints; the transcript remains in the page. Cached and curated definitions work without another provider request.

## Requirements

- Node.js 22.14 or newer. Node 26 LTS is recommended when available.
- Desktop Chromium or Chrome for manual use.
- Tavily is optional. Offline glossary explanations require no account or key.

## Run locally

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:4311`, then load `extension/` from `chrome://extensions` using **Load unpacked**. The local server is bound to `127.0.0.1` only.

The extension starts with online lookup disabled. Open its toolbar settings to enable it. For live lookup, copy `.env.example` to `.env`, set `TAVILY_API_KEY`, and export the value before starting the server. The server never sends the raw question or answer; it receives only a bounded term, domain, and short sense hint.

## Verify and package

```sh
npm run check
npm run package
```

`npm run check` runs Node logic/API checks and the installed extension in Playwright's bundled Chromium. Packaging copies the extension without compilation to `dist/ai-chat-keyword-explainer-unpacked/` and creates `dist/ai-chat-keyword-explainer-chrome.zip`.

## Project layout

- `extension/`: Manifest V3 extension, settings, content UI, glossary, and selection logic.
- `simulator/`: deterministic local chat and streaming-answer fixture.
- `backend/`: loopback HTTP API, SQLite cache/budget repository, and Tavily adapter.
- `tests/`: logic, backend, and persistent-browser extension checks.
- `docs/`: architecture, privacy, verification, and later-hosting notes.

## Current limits

- Composer adapters and representative layouts are covered for ChatGPT, Claude, and Microsoft Copilot. Their live sites can change independently and have not been verified in a signed-in browser session.
- English and desktop Chromium are the only supported targets.
- The backend has no public authentication because it only accepts loopback traffic. Do not expose it publicly.
- Node 22 prints an experimental SQLite warning. Node 26 is the intended long-term runtime.
- A real Tavily lookup was verified locally through the application backend. Automated tests continue to use deterministic provider doubles so routine checks do not consume credits.
