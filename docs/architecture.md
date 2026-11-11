# AI Loading Catch Up architecture

The content script observes submitted messages and visible assistant text. It runs deterministic local term selection and owns the current exchange UI in an isolated Shadow DOM. The background worker owns settings, learned definitions, and optional communication with the loopback backend. The backend owns the Tavily key, SQLite cache, monthly request budget, and in-flight deduplication.

Raw questions and answers remain in the active tab. Only a selected term, public domain, and short sense hint may be sent to the local backend. Conversation identifiers stay inside the extension.

The local simulator implements the same DOM adapter contract used by the ChatGPT adapter. The ChatGPT selectors are best-effort fixtures and require separate live-site validation.
