# Privacy and security model

The extension examines only supported chat message containers in the active page. It does not store the transcript, alter prompts, inspect cookies, request browsing history, or use broad host permissions. Its release surface is limited to the simulator host and `chatgpt.com`.

Seed and learned definitions are rendered with DOM text nodes. Source links must be HTTP or HTTPS. Settings and learned definitions use `chrome.storage.local`; learned entries are bounded to 1,000 records and roughly 4 MiB with batched least-recently-used eviction.

Online lookup is opt-in. The content script selects a term locally and sends only the term, inferred public domain, and a short sense hint to the background worker. The loopback backend validates the request, keeps the Tavily key outside the extension, and never accepts a raw transcript field. It binds to `127.0.0.1` and is not suitable as a public endpoint.
