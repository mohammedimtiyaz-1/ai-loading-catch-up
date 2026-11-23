(() => {
  const core = globalThis.ThreeKeywordsCore;
  const glossary = globalThis.ThreeKeywordsGlossary || [];
  const UI_HOST_ID = "ai-loading-catch-up-root";
  const HIGHLIGHT_STYLE_ID = "ai-loading-catch-up-highlight-style";
  const DRAFT_HIGHLIGHT_NAME = "ai-chat-keyword-explainer-draft";
  const DEBOUNCE_MS = 3000;
  let settings = { enabled: true, onlineLookup: false };
  let observer = null;
  let route = location.href;
  let routeTimer = null;
  let answerTimer = null;
  let maxWaitTimer = null;
  let draftTimer = null;
  let draftRevision = 0;
  let lastDraftText = "";
  let baselineUserNodes = new WeakSet();
  let state = freshState();
  let ui = null;
  const inlineDefinitions = new WeakMap();
  const annotationTimers = new Map();
  let draftHighlightRanges = [];

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
    scheduleDraftProcessing(findComposer());
    document.addEventListener("input", onComposerInput, true);
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
      composer: '#prompt-textarea, #mobile-composer-prompt, [data-testid="prompt-textarea"], [data-testid="composer-input"], div.ProseMirror[contenteditable="true"], [contenteditable="true"][role="textbox"]'
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
    scheduleDraftProcessing(findComposer());
    if (state.exchangeId && !state.isDraft) scheduleAnswerProcessing();
  }

  function onComposerInput(event) {
    if (!settings.enabled) return;
    const composer = event.target?.matches?.(selectors().composer) ? event.target : event.target?.closest?.(selectors().composer) || findComposer();
    if (!composer) return;
    scheduleDraftProcessing(composer);
  }

  function composerText(composer) {
    return String(composer?.value ?? visibleText(composer)).replace(/\s+/g, " ").trim();
  }

  function scheduleDraftProcessing(composer) {
    if (!composer || composerText(composer) === lastDraftText) return;
    clearTimeout(draftTimer);
    clearDraftHighlights();
    draftTimer = setTimeout(() => processDraft(composer), DEBOUNCE_MS);
  }

  function processDraft(composer) {
    const text = composerText(composer);
    lastDraftText = text;
    if (!text) {
      return;
    }
    const revision = ++draftRevision;
    state = { ...freshState(), exchangeId: `draft-${revision}`, questionRevision: revision, isDraft: true };
    annotateComposer(composer, text, revision);
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
    lastDraftText = questionText.replace(/\s+/g, " ").trim();
    const id = node.dataset.exchangeId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    state = { ...freshState(), exchangeId: id, questionRevision: 1 };
    clearDraftHighlights();
    scheduleInlineAnnotations(node, questionText, DEBOUNCE_MS);
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
    scheduleInlineAnnotations(node, text, DEBOUNCE_MS);
  }

  function checkRoute() {
    if (location.href === route) return;
    route = location.href;
    state = freshState();
    lastDraftText = "";
    clearTimeout(draftTimer);
    clearAnnotationTimers();
    clearDraftHighlights();
    clearInlineAnnotations();
    baseline();
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
    installHighlightStyle();
    const host = document.createElement("div");
    host.id = UI_HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; color-scheme: var(--akx-color-scheme, light); }
        .term-tooltip { display: none; position: fixed; z-index: 2147483647; width: min(270px, calc(100vw - 24px)); box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--akx-border, #d9d4e8); border-radius: 9px; color: var(--akx-text, #17151f); background: var(--akx-surface, #fff); box-shadow: 0 8px 28px #0003; font: var(--akx-font-size, 12px)/1.38 var(--akx-font-family, system-ui, sans-serif); pointer-events: none; }
        .term-tooltip.show { display: block; }
        @media (forced-colors: active) { .term-tooltip { color: CanvasText; background: Canvas; border-color: CanvasText; box-shadow: none; } }
      </style>
      <aside class="term-tooltip" role="tooltip"></aside>`;
    document.documentElement.append(host);
    ui = { host, shadow, tooltip: shadow.querySelector(".term-tooltip") };
    document.addEventListener("pointerover", showInlineTooltip, true);
    document.addEventListener("pointerout", hideInlineTooltip, true);
    document.addEventListener("focusin", showInlineTooltip, true);
    document.addEventListener("focusout", hideInlineTooltip, true);
    document.addEventListener("pointermove", showDraftTooltip, true);
    document.addEventListener("keydown", hideTooltipOnEscape, true);
  }

  function unmount() {
    document.removeEventListener("pointerover", showInlineTooltip, true);
    document.removeEventListener("pointerout", hideInlineTooltip, true);
    document.removeEventListener("focusin", showInlineTooltip, true);
    document.removeEventListener("focusout", hideInlineTooltip, true);
    document.removeEventListener("pointermove", showDraftTooltip, true);
    document.removeEventListener("keydown", hideTooltipOnEscape, true);
    document.getElementById(HIGHLIGHT_STYLE_ID)?.remove();
    ui?.host.remove();
    ui = null;
    clearTimeout(answerTimer);
    clearTimeout(maxWaitTimer);
    clearTimeout(draftTimer);
    clearAnnotationTimers();
    clearDraftHighlights();
    clearInlineAnnotations();
  }

  function installHighlightStyle() {
    if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = `
      ::highlight(${DRAFT_HIGHLIGHT_NAME}) {
        color: inherit;
        background-color: rgba(124, 92, 255, 0.24);
        text-decoration: underline dotted currentColor 1.5px;
        text-underline-offset: 3px;
      }
    `;
    document.documentElement.append(style);
  }

  function syncVisualTheme(anchor) {
    const surface = composedBackground(anchor);
    const anchorStyle = getComputedStyle(anchor);
    const pageStyle = getComputedStyle(document.body || document.documentElement);
    let textColor = parseColor(anchorStyle.color) || parseColor(pageStyle.color);
    const dark = relativeLuminance(surface) < 0.42;
    if (!textColor || contrastRatio(surface, textColor) < 3) textColor = dark ? { r: 245, g: 245, b: 245, a: 1 } : { r: 28, g: 28, b: 28, a: 1 };
    const fontSize = Math.min(14, Math.max(12, Number.parseFloat(anchorStyle.fontSize) || 13));
    ui.host.style.setProperty("--akx-surface", colorString(surface));
    ui.host.style.setProperty("--akx-text", colorString(textColor));
    ui.host.style.setProperty("--akx-muted", colorString({ ...textColor, a: 0.68 }));
    ui.host.style.setProperty("--akx-border", colorString({ ...textColor, a: dark ? 0.24 : 0.16 }));
    ui.host.style.setProperty("--akx-hover", colorString({ ...textColor, a: 0.08 }));
    ui.host.style.setProperty("--akx-font-family", anchorStyle.fontFamily || pageStyle.fontFamily || "system-ui, sans-serif");
    ui.host.style.setProperty("--akx-font-size", `${fontSize}px`);
    ui.host.style.setProperty("--akx-color-scheme", dark ? "dark" : "light");
    ui.host.dataset.theme = dark ? "dark" : "light";
  }

  function composedBackground(node) {
    const darkPreference = matchMedia("(prefers-color-scheme: dark)").matches;
    let result = darkPreference ? { r: 32, g: 32, b: 32, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
    const layers = [];
    for (let current = node; current instanceof Element; current = current.parentElement) {
      const color = parseColor(getComputedStyle(current).backgroundColor);
      if (color?.a) layers.push(color);
    }
    for (const layer of layers.reverse()) result = compositeColor(layer, result);
    return { ...result, a: 1 };
  }

  function parseColor(value) {
    const numbers = String(value || "").match(/[\d.]+/g)?.map(Number);
    if (!numbers || numbers.length < 3) return null;
    return { r: numbers[0], g: numbers[1], b: numbers[2], a: numbers[3] ?? 1 };
  }

  function compositeColor(foreground, background) {
    const alpha = foreground.a + background.a * (1 - foreground.a);
    if (!alpha) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
      g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
      b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
      a: alpha
    };
  }

  function colorString(color) {
    return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${Number(color.a ?? 1).toFixed(3)})`;
  }

  function relativeLuminance(color) {
    const channel = (value) => {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return channel(color.r) * 0.2126 + channel(color.g) * 0.7152 + channel(color.b) * 0.0722;
  }

  function contrastRatio(first, second) {
    const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
    const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
    return (lighter + 0.05) / (darker + 0.05);
  }

  async function annotateComposer(composer, text, revision) {
    if (!composer?.isContentEditable || !globalThis.CSS?.highlights || typeof globalThis.Highlight !== "function") return;
    const candidates = core.answerCandidates(text, 5, glossary);
    const available = candidates.filter((candidate) => candidate.definition);
    applyDraftDefinitions(composer, available);
    const unresolved = candidates.filter((candidate) => !candidate.definition).slice(0, 3);
    if (!settings.onlineLookup || !unresolved.length) return;
    const response = await send({
      type: "definition:resolve",
      payload: {
        requestId: crypto.randomUUID(),
        terms: unresolved.map(({ term, domain, senseHint }) => ({ term, domain, senseHint }))
      }
    });
    if (draftRevision !== revision || !composer.isConnected || composerText(composer) !== text) return;
    unresolved.forEach((candidate, index) => {
      const result = response?.results?.[index];
      if (result?.status === "resolved" && result.definition) available.push({ ...candidate, definition: result.definition });
    });
    applyDraftDefinitions(composer, available);
  }

  function applyDraftDefinitions(composer, candidates) {
    clearDraftHighlights();
    for (const candidate of candidates) {
      const range = firstTextRange(composer, candidate.aliases);
      if (range) draftHighlightRanges.push({ range, definition: candidate.definition });
    }
    if (draftHighlightRanges.length) CSS.highlights.set(DRAFT_HIGHLIGHT_NAME, new Highlight(...draftHighlightRanges.map((item) => item.range)));
  }

  function firstTextRange(root, aliases) {
    const ordered = [...new Set(aliases)].sort((a, b) => b.length - a.length);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode = walker.nextNode())) {
      for (const alias of ordered) {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = new RegExp(`(^|[^a-z0-9])(${escaped})(?=$|[^a-z0-9])`, "i").exec(textNode.data);
        if (!match) continue;
        const start = match.index + match[1].length;
        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, start + match[2].length);
        return range;
      }
    }
    return null;
  }

  function clearDraftHighlights() {
    globalThis.CSS?.highlights?.delete(DRAFT_HIGHLIGHT_NAME);
    draftHighlightRanges = [];
    if (ui?.tooltip?.dataset.owner === "draft") ui.tooltip.classList.remove("show");
  }

  function scheduleInlineAnnotations(node, text, delay) {
    clearTimeout(annotationTimers.get(node));
    const timer = setTimeout(() => {
      annotationTimers.delete(node);
      annotateMessage(node, text);
    }, delay);
    annotationTimers.set(node, timer);
  }

  async function annotateMessage(node, text) {
    if (!node?.isConnected || visibleText(node) !== text) return;
    const candidates = core.answerCandidates(text, 5, glossary);
    if (!candidates.length) return;
    clearInlineAnnotations(node);
    for (const candidate of candidates) {
      if (candidate.definition) underlineFirstOccurrence(node, candidate.aliases, candidate.definition);
    }
    const unresolved = candidates.filter((candidate) => !candidate.definition).slice(0, 3);
    if (!settings.onlineLookup || !unresolved.length) return;
    const response = await send({
      type: "definition:resolve",
      payload: {
        requestId: crypto.randomUUID(),
        terms: unresolved.map(({ term, domain, senseHint }) => ({ term, domain, senseHint }))
      }
    });
    if (!node.isConnected || visibleText(node) !== text) return;
    unresolved.forEach((candidate, index) => {
      const result = response?.results?.[index];
      if (result?.status === "resolved" && result.definition) underlineFirstOccurrence(node, candidate.aliases, result.definition);
    });
  }

  function clearAnnotationTimers() {
    for (const timer of annotationTimers.values()) clearTimeout(timer);
    annotationTimers.clear();
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
        mark.style.textDecoration = "underline dotted currentColor 1.5px";
        mark.style.textUnderlineOffset = "3px";
        mark.style.backgroundColor = "rgba(124, 92, 255, 0.24)";
        mark.style.borderRadius = "3px";
        mark.style.boxDecorationBreak = "clone";
        mark.style.webkitBoxDecorationBreak = "clone";
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
    presentTooltip(mark.getBoundingClientRect(), definition, "inline", mark);
  }

  function showDraftTooltip(event) {
    if (!draftHighlightRanges.length || !ui?.tooltip || event.target?.closest?.('[data-ai-loading-catch-up-term="true"]')) return;
    const caret = document.caretPositionFromPoint?.(event.clientX, event.clientY);
    const fallback = !caret ? document.caretRangeFromPoint?.(event.clientX, event.clientY) : null;
    const node = caret?.offsetNode || fallback?.startContainer;
    const offset = caret?.offset ?? fallback?.startOffset;
    const item = node && draftHighlightRanges.find(({ range }) => range.startContainer === node && offset >= range.startOffset && offset <= range.endOffset);
    if (!item) {
      if (ui.tooltip.dataset.owner === "draft") ui.tooltip.classList.remove("show");
      return;
    }
    presentTooltip(item.range.getBoundingClientRect(), item.definition, "draft", node.parentElement);
  }

  function presentTooltip(rect, definition, owner, themeNode) {
    if (!ui?.tooltip || !rect) return;
    syncVisualTheme(themeNode || document.body);
    ui.tooltip.dataset.owner = owner;
    ui.tooltip.textContent = definition.oneLiner;
    ui.tooltip.classList.add("show");
    const width = Math.min(270, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    ui.tooltip.style.width = `${width}px`;
    ui.tooltip.style.left = `${left}px`;
    const height = ui.tooltip.getBoundingClientRect().height || 72;
    const top = rect.bottom + height + 8 < window.innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - height - 8);
    ui.tooltip.style.top = `${top}px`;
  }

  function hideInlineTooltip(event) {
    const mark = event.target?.closest?.('[data-ai-loading-catch-up-term="true"]');
    if (mark && ui?.tooltip?.dataset.owner === "inline") ui.tooltip.classList.remove("show");
  }

  function hideTooltipOnEscape(event) {
    if (event.key === "Escape" && ui?.tooltip?.classList.contains("show")) ui.tooltip.classList.remove("show");
  }

  start();
})();
