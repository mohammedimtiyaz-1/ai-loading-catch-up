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
  let draftTimer = null;
  let inlineTimer = null;
  let draftRevision = 0;
  let positionFrame = null;
  let anchorObserver = null;
  let observedAnchor = null;
  let baselineUserNodes = new WeakSet();
  let state = freshState();
  let ui = null;
  const inlineDefinitions = new WeakMap();

  function freshState() {
    return { exchangeId: null, questionRevision: 0, answerRevision: 0, slots: [], answerNode: null, answerText: "", ended: false, isDraft: false };
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
    document.addEventListener("input", onComposerInput, true);
    document.addEventListener("scroll", schedulePosition, true);
    window.addEventListener("resize", schedulePosition);
    chrome.storage.onChanged.addListener(onSettingsChanged);
    routeTimer = setInterval(checkRoute, 700);
  }

  function baseline() {
    baselineUserNodes = new WeakSet();
    for (const node of userMessageNodes()) baselineUserNodes.add(node);
  }

  function selectors() {
    if (location.hostname === "127.0.0.1") {
      return { user: '[data-role="user-message"]', assistant: '[data-role="assistant-message"]', composer: "#question" };
    }
    if (location.hostname === "claude.ai") {
      return {
        user: '[data-testid="user-message"], [data-is-user-message="true"]',
        assistant: '[data-testid="assistant-message"], [data-is-streaming], .font-claude-response',
        composer: '[data-testid="chat-input"][contenteditable="true"], [contenteditable="true"][aria-label*="message" i], [contenteditable="true"][role="textbox"]'
      };
    }
    if (location.hostname === "copilot.microsoft.com") {
      return {
        user: '[data-content="user-message"], [data-testid="user-message"]',
        assistant: '[data-content="ai-message"], [data-testid="assistant-message"]',
        composer: 'textarea#userInput, textarea[data-testid*="composer" i], textarea[placeholder*="message" i], [contenteditable="true"][role="textbox"]'
      };
    }
    return {
      user: '[data-message-author-role="user"], article[data-turn="user"]',
      assistant: '[data-message-author-role="assistant"], article[data-turn="assistant"]',
      composer: '#prompt-textarea, [data-testid="prompt-textarea"], div.ProseMirror[contenteditable="true"], [contenteditable="true"][role="textbox"]'
    };
  }

  function findComposer() {
    const primary = [...document.querySelectorAll(selectors().composer)];
    const candidates = primary.length ? primary : [...document.querySelectorAll('textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"][data-testid*="input" i]')];
    const visible = candidates
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 120 && rect.height > 18 && rect.bottom > 0 && rect.top < innerHeight && style.display !== "none" && style.visibility !== "hidden";
      })
      .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
    return visible[0] || candidates.at(-1) || null;
  }

  function findComposerAnchor(composer) {
    if (!composer) return null;
    const base = composer.getBoundingClientRect();
    let best = { node: composer, score: 0 };
    let candidate = composer.parentElement;
    for (let depth = 1; candidate && depth <= 6; depth += 1, candidate = candidate.parentElement) {
      const rect = candidate.getBoundingClientRect();
      if (rect.width < base.width || rect.width > Math.min(innerWidth * 0.9, base.width + 240)) continue;
      if (rect.height < base.height || rect.height > 220 || Math.abs(rect.bottom - base.bottom) > 110) continue;
      const style = getComputedStyle(candidate);
      const radius = Number.parseFloat(style.borderRadius) || 0;
      const namedComposer = /composer|prompt|input/i.test(`${candidate.id} ${candidate.className} ${candidate.getAttribute("data-testid") || ""} ${candidate.getAttribute("data-type") || ""}`);
      const semanticComposer = /composer|prompt|input/i.test(`${candidate.getAttribute("data-testid") || ""} ${candidate.getAttribute("data-type") || ""}`);
      const visuallyBounded = radius >= 8 || style.borderTopWidth !== "0px" || !["transparent", "rgba(0, 0, 0, 0)"].includes(style.backgroundColor);
      if (!visuallyBounded && !semanticComposer) continue;
      const score = (namedComposer ? 100 : 0) + (visuallyBounded ? 30 : 0) + Math.min(25, (rect.width - base.width) / 8) - depth * 3;
      if (score > best.score) best = { node: candidate, score };
    }
    return best.node;
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
    if (state.exchangeId && !state.isDraft) scheduleAnswerProcessing();
    schedulePosition();
  }

  function onComposerInput(event) {
    if (!settings.enabled) return;
    const composer = event.target?.matches?.(selectors().composer) ? event.target : event.target?.closest?.(selectors().composer);
    if (!composer) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => processDraft(composer), 450);
  }

  function processDraft(composer) {
    const text = String(composer?.value ?? visibleText(composer)).replace(/\s+/g, " ").trim();
    if (!text) {
      if (state.isDraft) { state = freshState(); render(); }
      return;
    }
    const revision = ++draftRevision;
    state = { ...freshState(), exchangeId: `draft-${revision}`, questionRevision: revision, isDraft: true };
    state.slots = core.createSlots(text, glossary);
    render();
    if (settings.onlineLookup && state.slots.length < 2) resolveUnknown(text, "question", 2 - state.slots.length);
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
    clearTimeout(draftTimer);
    clearInlineAnnotations();
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
    scheduleInlineAnnotations(node, text, state.exchangeId, state.answerRevision);
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
    clearTimeout(draftTimer);
    clearTimeout(inlineTimer);
    clearInlineAnnotations();
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
        .wrap { position: fixed; top: 24px; left: 24px; z-index: 2147483646; width: 320px; max-width: calc(100vw - 24px); font: 14px/1.42 system-ui, sans-serif; color: #17151f; }
        button { font: inherit; }
        .chip { display: none; margin: 0; border: 0; border-radius: 999px; padding: 9px 13px; color: white; background: #6d4aff; box-shadow: 0 6px 22px #0003; cursor: pointer; font-weight: 750; }
        .chip.show { display: block; }
        .chip.panel-open { display: none; }
        .panel { display: none; width: 100%; max-height: min(460px, var(--available-height, calc(100vh - 24px))); overflow: auto; box-sizing: border-box; padding: 12px; border: 1px solid #d9d4e8; border-radius: 16px; background: #fff; box-shadow: 0 16px 50px #0003; }
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
        .term-tooltip { display: none; position: fixed; z-index: 2147483647; width: min(290px, calc(100vw - 24px)); box-sizing: border-box; padding: 10px 12px; border: 1px solid #d9d4e8; border-radius: 10px; color: #17151f; background: #fff; box-shadow: 0 10px 34px #0004; font: 13px/1.4 system-ui, sans-serif; pointer-events: none; }
        .term-tooltip.show { display: block; }
        button:focus-visible, a:focus-visible { outline: 3px solid #ffb000; outline-offset: 2px; }
        @media (prefers-color-scheme: dark) { .panel, .term-tooltip { background: #24212d; color: #f7f4ff; border-color: #494354; } .card { border-color: #494354; } .muted { color: #c6bfce; } a { color: #baaaff; } }
        @media (prefers-reduced-motion: no-preference) { .chip.show { animation: pop .18s ease-out; } @keyframes pop { from { transform: scale(.92); opacity: .5; } } }
      </style>
      <div class="wrap">
        <button class="chip" type="button" aria-expanded="false" aria-haspopup="dialog">0 terms</button>
        <section class="panel" role="dialog" aria-modal="false" aria-labelledby="tk-title">
          <div class="header"><h2 id="tk-title">AI Loading Catch Up</h2><button class="close" type="button" aria-label="Close explanations">×</button></div>
          <div class="cards" aria-live="polite"></div>
        </section>
        <aside class="term-tooltip" role="tooltip"></aside>
      </div>`;
    document.documentElement.append(host);
    const chip = shadow.querySelector(".chip");
    const panel = shadow.querySelector(".panel");
    const close = shadow.querySelector(".close");
    chip.addEventListener("click", () => setOpen(!panel.classList.contains("open")));
    close.addEventListener("click", () => setOpen(false));
    shadow.addEventListener("keydown", (event) => { if (event.key === "Escape") setOpen(false); });
    function setOpen(open, moveFocus = true) {
      panel.classList.toggle("open", open);
      chip.classList.toggle("panel-open", open);
      chip.setAttribute("aria-expanded", String(open));
      if (moveFocus) {
        if (open) close.focus(); else chip.focus();
      }
    }
    ui = { host, shadow, chip, panel, cards: shadow.querySelector(".cards"), wrap: shadow.querySelector(".wrap"), tooltip: shadow.querySelector(".term-tooltip"), setOpen };
    document.addEventListener("pointerover", showInlineTooltip, true);
    document.addEventListener("pointerout", hideInlineTooltip, true);
    document.addEventListener("focusin", showInlineTooltip, true);
    document.addEventListener("focusout", hideInlineTooltip, true);
    render();
  }

  function unmount() {
    document.removeEventListener("pointerover", showInlineTooltip, true);
    document.removeEventListener("pointerout", hideInlineTooltip, true);
    document.removeEventListener("focusin", showInlineTooltip, true);
    document.removeEventListener("focusout", hideInlineTooltip, true);
    ui?.host.remove();
    ui = null;
    clearTimeout(answerTimer);
    clearTimeout(maxWaitTimer);
    clearTimeout(draftTimer);
    clearTimeout(inlineTimer);
    anchorObserver?.disconnect();
    anchorObserver = null;
    observedAnchor = null;
    clearInlineAnnotations();
  }

  function render() {
    if (!ui) return;
    const count = state.slots.length;
    ui.host.dataset.termCount = String(count);
    ui.chip.textContent = `${count} ${count === 1 ? "term" : "terms"}`;
    ui.chip.classList.toggle("show", count > 0);
    if (!count) ui.setOpen(false, false);
    ui.cards.replaceChildren(...state.slots.map(cardFor));
    if (count > 0) ui.setOpen(true, false);
    schedulePosition();
  }

  function schedulePosition() {
    if (!ui || positionFrame) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = null;
      positionBesideContent();
    });
  }

  function positionBesideContent() {
    if (!ui) return;
    const pageZoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    ui.host.style.zoom = String(1 / pageZoom);
    const composer = findComposer();
    const anchor = findComposerAnchor(composer);
    syncAnchorObserver(anchor);
    if (!anchor) {
      ui.wrap.style.visibility = "hidden";
      ui.host.dataset.placement = "waiting-for-composer";
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const gap = 12;
    const edge = 12;
    const available = Math.floor(window.innerWidth - rect.right - gap - edge);
    const hasRightRail = available >= 96;
    const width = hasRightRail ? (available >= 180 ? Math.min(340, available) : available) : Math.min(300, window.innerWidth - edge * 2);
    const left = hasRightRail ? rect.right + gap : window.innerWidth - width - edge;
    const top = Math.max(edge, Math.min(rect.top, window.innerHeight - edge - 40));
    ui.wrap.style.visibility = "visible";
    ui.wrap.style.width = `${width}px`;
    ui.wrap.style.left = `${left}px`;
    ui.wrap.style.top = `${top}px`;
    ui.wrap.style.setProperty("--available-height", `${Math.max(120, window.innerHeight - top - edge)}px`);
    ui.host.dataset.placement = hasRightRail ? "composer-right" : "composer-edge-fallback";
    ui.host.dataset.anchorTag = anchor.tagName.toLowerCase();
  }

  function syncAnchorObserver(anchor) {
    if (observedAnchor === anchor) return;
    anchorObserver?.disconnect();
    observedAnchor = anchor;
    if (!anchor || typeof ResizeObserver !== "function") return;
    anchorObserver = new ResizeObserver(schedulePosition);
    anchorObserver.observe(anchor);
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

  function scheduleInlineAnnotations(node, text, exchangeId, answerRevision) {
    clearTimeout(inlineTimer);
    inlineTimer = setTimeout(() => annotateAnswer(node, text, exchangeId, answerRevision), 1200);
  }

  async function annotateAnswer(node, text, exchangeId, answerRevision) {
    if (!settings.onlineLookup || !node?.isConnected || visibleText(node) !== text) return;
    const candidates = core.answerCandidates(text, 5, glossary);
    if (!candidates.length) return;
    const chunks = [];
    for (let index = 0; index < candidates.length; index += 3) chunks.push(candidates.slice(index, index + 3));
    const responses = await Promise.all(chunks.map((chunk) => send({
      type: "definition:resolve",
      payload: {
        requestId: crypto.randomUUID(),
        terms: chunk.map(({ term, domain, senseHint }) => ({ term, domain, senseHint }))
      }
    })));
    if (state.exchangeId !== exchangeId || state.answerRevision !== answerRevision || state.answerNode !== node || visibleText(node) !== text) return;
    const results = responses.flatMap((response) => response?.results || []);
    clearInlineAnnotations(node);
    candidates.forEach((candidate, index) => {
      const definition = results[index]?.status === "resolved" ? results[index].definition : null;
      if (definition) underlineFirstOccurrence(node, candidate.aliases, definition);
    });
  }

  function underlineFirstOccurrence(root, aliases, definition) {
    const ordered = [...new Set(aliases)].sort((a, b) => b.length - a.length);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode = walker.nextNode())) {
      const parent = textNode.parentElement;
      if (!parent || parent.closest('[data-ai-loading-catch-up-term], a, button, code, pre, input, textarea, [contenteditable="true"]')) continue;
      for (const alias of ordered) {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = new RegExp(`(^|[^a-z0-9])(${escaped})(?=$|[^a-z0-9])`, "i").exec(textNode.data);
        if (!match) continue;
        const start = match.index + match[1].length;
        const before = textNode.data.slice(0, start);
        const termText = textNode.data.slice(start, start + match[2].length);
        const after = textNode.data.slice(start + match[2].length);
        const mark = document.createElement("span");
        mark.dataset.aiLoadingCatchUpTerm = "true";
        mark.tabIndex = 0;
        mark.textContent = termText;
        mark.style.textDecoration = "underline dotted #6d4aff 2px";
        mark.style.textUnderlineOffset = "3px";
        mark.style.cursor = "help";
        mark.setAttribute("aria-label", `${termText}: ${definition.oneLiner}`);
        inlineDefinitions.set(mark, definition);
        textNode.replaceWith(document.createTextNode(before), mark, document.createTextNode(after));
        return true;
      }
    }
    return false;
  }

  function clearInlineAnnotations(root = document) {
    for (const mark of root.querySelectorAll?.('[data-ai-loading-catch-up-term="true"]') || []) mark.replaceWith(document.createTextNode(mark.textContent || ""));
    if (ui?.tooltip) ui.tooltip.classList.remove("show");
  }

  function showInlineTooltip(event) {
    const mark = event.target?.closest?.('[data-ai-loading-catch-up-term="true"]');
    const definition = mark && inlineDefinitions.get(mark);
    if (!definition || !ui?.tooltip) return;
    ui.tooltip.textContent = definition.oneLiner;
    ui.tooltip.classList.add("show");
    const rect = mark.getBoundingClientRect();
    const width = Math.min(290, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top = rect.bottom + 98 < window.innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - 98);
    ui.tooltip.style.width = `${width}px`;
    ui.tooltip.style.left = `${left}px`;
    ui.tooltip.style.top = `${top}px`;
  }

  function hideInlineTooltip(event) {
    const mark = event.target?.closest?.('[data-ai-loading-catch-up-term="true"]');
    if (mark && ui?.tooltip) ui.tooltip.classList.remove("show");
  }

  function isSafeSource(url) {
    try { return ["http:", "https:"].includes(new URL(url).protocol); } catch { return false; }
  }

  start();
})();
