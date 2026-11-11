(() => {
  const core = globalThis.ThreeKeywordsCore;
  const glossary = globalThis.ThreeKeywordsGlossary || [];
  const UI_HOST_ID = "ai-loading-catch-up-root";
  let settings = { enabled: true, onlineLookup: false };
  let observer = null;
  let route = location.href;
  let routeTimer = null;
  let answerTimer = null;
  let maxWaitTimer = null;
  let baselineUserNodes = new WeakSet();
  let state = freshState();
  let ui = null;

  function freshState() {
    return { exchangeId: null, questionRevision: 0, answerRevision: 0, slots: [], answerNode: null, answerText: "", ended: false };
  }

  function send(message) {
    return new Promise((resolve) => {
      try { chrome.runtime.sendMessage(message, (response) => resolve(response)); } catch { resolve(null); }
    });
  }

  async function start() {
    const loaded = await send({ type: "settings:get" });
    if (loaded) settings = loaded;
    baseline();
    if (settings.enabled) mount();
    observe();
    chrome.storage.onChanged.addListener(onSettingsChanged);
    routeTimer = setInterval(checkRoute, 700);
  }

  function baseline() {
    baselineUserNodes = new WeakSet();
    for (const node of userMessageNodes()) baselineUserNodes.add(node);
  }

  function selectors() {
    if (location.hostname === "127.0.0.1") {
      return { user: '[data-role="user-message"]', assistant: '[data-role="assistant-message"]' };
    }
    return {
      user: '[data-message-author-role="user"], article[data-turn="user"]',
      assistant: '[data-message-author-role="assistant"], article[data-turn="assistant"]'
    };
  }

  function userMessageNodes() { return [...document.querySelectorAll(selectors().user)]; }
  function assistantMessageNodes() { return [...document.querySelectorAll(selectors().assistant)]; }

  function observe() {
    observer?.disconnect();
    observer = new MutationObserver(handleMutations);
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  }

  function handleMutations() {
    if (!settings.enabled) return;
    checkForQuestion();
    if (state.exchangeId) scheduleAnswerProcessing();
  }

  function checkForQuestion() {
    const nodes = userMessageNodes();
    for (const node of nodes) {
      if (baselineUserNodes.has(node)) continue;
      baselineUserNodes.add(node);
      const text = visibleText(node);
      if (text) beginExchange(node, text);
    }
  }

  function visibleText(node) {
    return (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function beginExchange(node, questionText) {
    const id = node.dataset.exchangeId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    state = { ...freshState(), exchangeId: id, questionRevision: 1 };
    state.slots = core.createSlots(questionText, glossary);
    render();
    if (settings.onlineLookup && state.slots.length < 2) resolveUnknown(questionText, "question", 2 - state.slots.length);
  }

  function scheduleAnswerProcessing() {
    clearTimeout(answerTimer);
    answerTimer = setTimeout(processAnswer, 300);
    if (!maxWaitTimer) maxWaitTimer = setTimeout(processAnswer, 1000);
  }

  function processAnswer() {
    clearTimeout(answerTimer);
    clearTimeout(maxWaitTimer);
    answerTimer = null;
    maxWaitTimer = null;
    const candidates = assistantMessageNodes();
    const node = [...candidates].reverse().find((item) => {
      const exchangeId = item.dataset.exchangeId;
      return !exchangeId || exchangeId === state.exchangeId;
    });
    if (!node) return;
    const text = visibleText(node);
    if (!text || text === state.answerText) return;
    if (state.answerNode && state.answerNode !== node) {
      state.answerRevision += 1;
      state.slots = state.slots.filter((slot) => slot.source === "question");
      state.answerText = "";
    }
    state.answerNode = node;
    state.answerText = text;
    state.answerRevision ||= 1;
    const before = state.slots.length;
    const ids = state.slots.map((slot) => slot.definition?.canonicalTermId).filter(Boolean);
    const definitions = core.selectTerms(text, 3 - state.slots.length, ids, glossary);
    for (const definition of definitions) state.slots.push({ source: "answer", status: "ready", definition });
    if (state.slots.length !== before) render();
    if (settings.onlineLookup && state.slots.length < 3) resolveUnknown(text, "answer", 3 - state.slots.length);
  }

  async function resolveUnknown(text, source, limit) {
    const exchangeId = state.exchangeId;
    const answerRevision = state.answerRevision;
    const knownAliases = state.slots.flatMap((slot) => slot.definition?.aliases || [slot.definition?.displayTerm]).filter(Boolean);
    const terms = core.unknownCandidates(text, limit, knownAliases);
    if (!terms.length) return;
    const pending = terms.map((term) => ({ source, status: "loading", candidate: term }));
    state.slots.push(...pending.slice(0, 3 - state.slots.length));
    render();
    const response = await send({ type: "definition:resolve", payload: { requestId: crypto.randomUUID(), terms } });
    if (state.exchangeId !== exchangeId || (source === "answer" && state.answerRevision !== answerRevision)) return;
    pending.forEach((slot, index) => {
      const result = response?.results?.[index];
      if (result?.status === "resolved") {
        slot.status = "ready";
        slot.definition = result.definition;
      } else {
        slot.status = "unavailable";
        slot.reason = result?.reason || result?.status || "unavailable";
      }
    });
    render();
  }

  function checkRoute() {
    if (location.href === route) return;
    route = location.href;
    state = freshState();
    baseline();
    render();
  }

  function onSettingsChanged(changes, area) {
    if (area !== "local") return;
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.onlineLookup) settings.onlineLookup = changes.onlineLookup.newValue;
    if (!settings.enabled) unmount();
    else mount();
  }

  function mount() {
    if (document.getElementById(UI_HOST_ID)) return;
    const host = document.createElement("div");
    host.id = UI_HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap { position: fixed; right: 20px; bottom: 22px; z-index: 2147483646; font: 14px/1.42 system-ui, sans-serif; color: #17151f; }
        button { font: inherit; }
        .chip { display: none; border: 0; border-radius: 999px; padding: 10px 15px; color: white; background: #6d4aff; box-shadow: 0 6px 22px #0003; cursor: pointer; font-weight: 750; }
        .chip.show { display: block; }
        .panel { display: none; position: absolute; right: 0; bottom: 50px; width: min(360px, calc(100vw - 32px)); max-height: min(460px, calc(100vh - 100px)); overflow: auto; box-sizing: border-box; padding: 12px; border: 1px solid #d9d4e8; border-radius: 16px; background: #fff; box-shadow: 0 16px 50px #0003; }
        .panel.open { display: block; }
        .header { display: flex; justify-content: space-between; align-items: center; margin: 0 0 8px; }
        h2 { font-size: 15px; margin: 0; }
        .close { border: 0; background: transparent; cursor: pointer; font-size: 20px; line-height: 1; }
        .card { padding: 11px 0; border-top: 1px solid #ece8f2; }
        .card:first-of-type { border-top: 0; }
        h3 { font-size: 14px; margin: 0 0 4px; }
        p { margin: 0; }
        .muted { color: #6d6878; }
        a { display: inline-block; margin-top: 6px; color: #5533dd; }
        button:focus-visible, a:focus-visible { outline: 3px solid #ffb000; outline-offset: 2px; }
        @media (prefers-color-scheme: dark) { .panel { background: #24212d; color: #f7f4ff; border-color: #494354; } .card { border-color: #494354; } .muted { color: #c6bfce; } a { color: #baaaff; } }
        @media (prefers-reduced-motion: no-preference) { .chip.show { animation: pop .18s ease-out; } @keyframes pop { from { transform: scale(.92); opacity: .5; } } }
      </style>
      <div class="wrap">
        <section class="panel" role="dialog" aria-modal="false" aria-labelledby="tk-title">
          <div class="header"><h2 id="tk-title">AI Loading Catch Up</h2><button class="close" type="button" aria-label="Close explanations">×</button></div>
          <div class="cards" aria-live="polite"></div>
        </section>
        <button class="chip" type="button" aria-expanded="false" aria-haspopup="dialog">0 terms</button>
      </div>`;
    document.documentElement.append(host);
    const chip = shadow.querySelector(".chip");
    const panel = shadow.querySelector(".panel");
    const close = shadow.querySelector(".close");
    chip.addEventListener("click", () => setOpen(!panel.classList.contains("open")));
    close.addEventListener("click", () => setOpen(false));
    shadow.addEventListener("keydown", (event) => { if (event.key === "Escape") setOpen(false); });
    function setOpen(open) {
      panel.classList.toggle("open", open);
      chip.setAttribute("aria-expanded", String(open));
      if (open) close.focus(); else chip.focus();
    }
    ui = { host, shadow, chip, panel, cards: shadow.querySelector(".cards") };
    render();
  }

  function unmount() {
    ui?.host.remove();
    ui = null;
    clearTimeout(answerTimer);
    clearTimeout(maxWaitTimer);
  }

  function render() {
    if (!ui) return;
    const count = state.slots.length;
    ui.chip.textContent = `${count} ${count === 1 ? "term" : "terms"}`;
    ui.chip.classList.toggle("show", count > 0);
    if (!count) ui.panel.classList.remove("open");
    ui.cards.replaceChildren(...state.slots.map(cardFor));
  }

  function cardFor(slot) {
    const card = document.createElement("article");
    card.className = "card";
    const title = document.createElement("h3");
    title.textContent = slot.definition?.displayTerm || slot.candidate?.term || "Term";
    const body = document.createElement("p");
    if (slot.status === "ready") body.textContent = slot.definition.oneLiner;
    else if (slot.status === "loading") { body.textContent = "Finding a brief explanation…"; body.className = "muted"; }
    else { body.textContent = slot.reason === "unconfigured" ? "Online lookup is not configured." : "An explanation is not available right now."; body.className = "muted"; }
    card.append(title, body);
    const source = slot.definition?.sources?.[0];
    if (source && isSafeSource(source.url)) {
      const link = document.createElement("a");
      link.textContent = source.title || "Source";
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      card.append(link);
    }
    return card;
  }

  function isSafeSource(url) {
    try { return ["http:", "https:"].includes(new URL(url).protocol); } catch { return false; }
  }

  start();
})();
