const DEFAULTS = {
  enabled: true,
  onlineLookup: false,
  backendUrl: "http://127.0.0.1:4311"
};
const MAX_ENTRIES = 1000;
const MAX_BYTES = 4 * 1024 * 1024;
const memoryCache = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const missing = Object.fromEntries(Object.entries(DEFAULTS).filter(([key]) => current[key] === undefined));
  if (Object.keys(missing).length) await chrome.storage.local.set(missing);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;
  if (message.type === "settings:get") {
    chrome.storage.local.get(DEFAULTS).then(sendResponse);
    return true;
  }
  if (message.type === "settings:set") {
    const allowed = {};
    if (typeof message.settings?.enabled === "boolean") allowed.enabled = message.settings.enabled;
    if (typeof message.settings?.onlineLookup === "boolean") allowed.onlineLookup = message.settings.onlineLookup;
    if (typeof message.settings?.backendUrl === "string" && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(message.settings.backendUrl)) {
      allowed.backendUrl = message.settings.backendUrl.replace(/\/$/, "");
    }
    chrome.storage.local.set(allowed).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "cache:clear") {
    clearLearned().then(sendResponse);
    return true;
  }
  if (message.type === "definition:resolve") {
    resolveDefinitions(message.payload, sender).then(sendResponse);
    return true;
  }
  return false;
});

async function clearLearned() {
  const stored = await chrome.storage.local.get("learnedDefinitionKeys");
  const keys = Array.isArray(stored.learnedDefinitionKeys) ? stored.learnedDefinitionKeys : [];
  if (keys.length) await chrome.storage.local.remove(keys.map((key) => `definition:${key}`));
  await chrome.storage.local.set({ learnedDefinitionKeys: [] });
  memoryCache.clear();
  return { ok: true, removed: keys.length };
}

function validatePayload(payload) {
  if (!payload || !Array.isArray(payload.terms) || payload.terms.length < 1 || payload.terms.length > 3) return false;
  return payload.terms.every((term) =>
    term && typeof term.term === "string" && term.term.length > 0 && term.term.length <= 120 &&
    typeof term.domain === "string" && term.domain.length <= 40 &&
    typeof term.senseHint === "string" && term.senseHint.length <= 160
  );
}

function cacheKey(term) {
  return `v1:en:${term.domain.toLowerCase()}:${term.term.toLowerCase().replace(/\s+/g, "-")}:${term.senseHint.toLowerCase().replace(/\s+/g, "-")}`;
}

async function resolveDefinitions(payload, sender) {
  if (!validatePayload(payload)) return { ok: false, error: "invalid_request", results: [] };
  if (!sender.tab?.id) return { ok: false, error: "invalid_sender", results: [] };
  const settings = await chrome.storage.local.get(DEFAULTS);
  const results = new Array(payload.terms.length);
  const misses = [];

  for (const [index, term] of payload.terms.entries()) {
    const key = cacheKey(term);
    const hot = memoryCache.get(key);
    if (hot && Date.parse(hot.refreshAfter) > Date.now()) {
      results[index] = { status: "resolved", definition: hot, cache: "memory" };
      continue;
    }
    const stored = await chrome.storage.local.get(`definition:${key}`);
    const record = stored[`definition:${key}`];
    if (record && Date.parse(record.refreshAfter) > Date.now()) {
      memoryCache.set(key, record);
      results[index] = { status: "resolved", definition: record, cache: "local" };
    } else {
      misses.push({ term, key, index });
    }
  }

  if (misses.length && !settings.onlineLookup) {
    for (const miss of misses) results[miss.index] = { status: "unavailable", reason: "online_disabled" };
  } else if (misses.length) {
    try {
      const response = await fetch(`${settings.backendUrl}/v1/definitions/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), language: "en", terms: misses.map(({ term }) => term) }),
        signal: AbortSignal.timeout(5500)
      });
      const data = await response.json();
      for (let index = 0; index < misses.length; index += 1) {
        const result = data.results?.[index] || { status: "unavailable" };
        results[misses[index].index] = result;
        if (result.status === "resolved" && result.definition) await storeDefinition(misses[index].key, result.definition);
      }
    } catch {
      for (const miss of misses) results[miss.index] = { status: "unavailable" };
    }
  }
  return { ok: true, requestId: payload.requestId, results };
}

async function storeDefinition(key, definition) {
  const safe = sanitizeDefinition(definition);
  if (!safe) return;
  memoryCache.set(key, safe);
  const stored = await chrome.storage.local.get("learnedDefinitionKeys");
  const keys = Array.isArray(stored.learnedDefinitionKeys) ? stored.learnedDefinitionKeys.filter((item) => item !== key) : [];
  keys.push(key);
  while (keys.length > MAX_ENTRIES) {
    const evicted = keys.shift();
    memoryCache.delete(evicted);
    await chrome.storage.local.remove(`definition:${evicted}`);
  }
  await chrome.storage.local.set({ [`definition:${key}`]: safe, learnedDefinitionKeys: keys });
  const bytes = JSON.stringify(await chrome.storage.local.get(keys.map((item) => `definition:${item}`))).length * 2;
  if (bytes > MAX_BYTES) {
    const removeCount = Math.max(1, Math.ceil(keys.length * 0.1));
    const removed = keys.splice(0, removeCount);
    await chrome.storage.local.remove(removed.map((item) => `definition:${item}`));
    await chrome.storage.local.set({ learnedDefinitionKeys: keys });
  }
}

function sanitizeDefinition(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.oneLiner !== "string" || value.oneLiner.trim().split(/\s+/).length > 40) return null;
  const sources = Array.isArray(value.sources) ? value.sources.filter((source) => {
    try { return typeof source.title === "string" && ["http:", "https:"].includes(new URL(source.url).protocol); } catch { return false; }
  }).slice(0, 3) : [];
  if (!sources.length) return null;
  return { ...value, oneLiner: value.oneLiner.trim(), sources };
}
